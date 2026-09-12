import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import { ApiError } from "../../shared/api-error";
import { ApiResponse } from "../../shared/api-response";
import { successWrapper, errorWrapper } from "../openapi/schemas";
import { getDb } from "../../db/connection";
import { publicRateLimiter, d1RateLimiter } from "../../middlewares/rate-limiter";
import { formAnswers, formFields, formFiles, formSubmissions, forms } from "../../db/schema";
import { eq, asc } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { CHOICE_FIELD_TYPES, FORM_FIELD_TYPES } from "./form.schema";
import { formIsOpen, parseFieldOptions } from "./form.service";
import type { AppContext } from "../../types";

// Kontrak identik dengan GET/POST /api/v1/campaigns/:slug di AdvocationDashboard
// supaya landing page cukup ganti base URL (src/lib/student-voice.ts).

const ok = (summary: string, description: string, schema: z.ZodTypeAny, extra: Record<number, { description: string }> = {}) =>
	describeRoute({
		summary,
		description,
		tags: ["Public Forms"],
		responses: {
			200: { description: "Success", content: { "application/json": { schema: resolver(schema) } } },
			404: { description: "Not found (draft/missing)", content: { "application/json": { schema: resolver(errorWrapper) } } },
			...extra,
		},
	});

const FIELD_HINTS: Record<string, string> = {
	short_text: "Isi dengan jawaban singkat dan langsung pada inti pertanyaan.",
	paragraph: "Jelaskan jawaban secara lengkap. Maksimal 10.000 karakter.",
	email: "Masukkan alamat email aktif, contoh: nama@email.com.",
	number: "Masukkan angka saja.",
	multiple_choice: "Pilih satu jawaban yang paling sesuai.",
	checkboxes: "Kamu dapat memilih lebih dari satu jawaban.",
	dropdown: "Buka daftar lalu pilih satu jawaban.",
	linear_scale: "Pilih satu angka pada skala yang tersedia.",
	date: "Pilih tanggal melalui kalender atau masukkan tanggal yang valid.",
	file: "Unggah maksimal 5 file, masing-masing maksimal 10MB.",
};

const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "zip"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_LENGTH = 10_000;

const fileExtension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

// Landing page zod hanya menerima options berupa array string. Skala linear
// dirender sebagai daftar pilihan angka (radio) — sama seperti pilihan biasa.
const publicFieldOptions = (options: ReturnType<typeof parseFieldOptions>): string[] => {
	if (Array.isArray(options)) return options.filter((o): o is string => typeof o === "string");
	if (options && typeof options === "object") {
		const { min, max } = options as { min: number; max: number };
		if (typeof min === "number" && typeof max === "number" && max >= min) {
			return Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
		}
	}
	return [];
};

export const publicFormRouter = new Hono<AppContext>();

publicFormRouter.use("*", publicRateLimiter);
// Lebih ketat dari events: form menerima tulisan bebas dari internet.
publicFormRouter.use("*", d1RateLimiter({ prefix: "public:forms", limit: 30, windowMs: 60_000 }));

publicFormRouter.get(
	"/:slug",
	ok("Public form detail", "Form terpublikasi beserta field-nya (tanpa jawaban). Draft/closed → 404.", z.object({}),
		{ 409: { description: "Form closed (masih terlihat tapi menolak respons)" } }),
	async (c) => {
		const { slug } = c.req.param();
		const db = getDb(c.env.DB);
		const [form] = await db.select().from(forms).where(eq(forms.slug, slug)).limit(1);
		if (!form || form.status === "draft") throw ApiError.notFound("Form tidak ditemukan.");

		const fields = await db.select().from(formFields).where(eq(formFields.formId, form.id)).orderBy(asc(formFields.sortOrder));
		return ApiResponse.ok(c, "OK", {
			slug: form.slug,
			title: form.title,
			description: form.description,
			status: form.status,
			isOpen: formIsOpen(form),
			// camelCase supaya zod CampaignSchema landing page (opensAt/closesAt) cocok.
			opensAt: form.opensAt,
			closesAt: form.closesAt,
			thank_you_message: form.thankYouMessage,
			fields: fields.map((f) => ({
				id: f.id,
				label: f.label,
				description: f.description,
				type: f.type,
				hint: FIELD_HINTS[f.type] ?? "Isi sesuai petunjuk pertanyaan.",
				required: f.required,
				options: publicFieldOptions(parseFieldOptions(f.options)),
			})),
		});
	},
);

publicFormRouter.post(
	"/:slug",
	ok("Submit public form response", "multipart/form-data: field_<id> per pertanyaan; _website honeypot diabaikan.", z.object({}), {
		409: { description: "Form tidak sedang menerima respons" },
		422: { description: "Validasi jawaban gagal" },
		429: { description: "Rate limit (30/menit/IP)" },
	}),
	async (c) => {
		const { slug } = c.req.param();
		const db = getDb(c.env.DB);

		let formData: FormData;
		try {
			formData = await c.req.formData();
		} catch {
			throw ApiError.badRequest("Gunakan multipart/form-data.");
		}

		// Honeypot bot: respons generik, tidak ada sinyal.
		if (String(formData.get("_website") ?? "").trim()) {
			return ApiResponse.created(c, "Respons diterima.", { submission_id: null });
		}

		const [form] = await db.select().from(forms).where(eq(forms.slug, slug)).limit(1);
		if (!form) throw ApiError.notFound("Form tidak ditemukan.");
		if (!formIsOpen(form)) {
			throw new ApiError(409, "Form sedang tidak menerima respons.");
		}

		const fields = await db.select().from(formFields).where(eq(formFields.formId, form.id)).orderBy(asc(formFields.sortOrder));
		const errors: Record<string, string[]> = {};
		const answers: Array<{ fieldId: string; fieldLabel: string; fieldType: string; value: string }> = [];
		const uploads: Array<{ fieldId: string; file: File }> = [];

		for (const field of fields) {
			const key = `field_${field.id}`;
			const type = field.type;

			if (type === "file") {
				const files = formData.getAll(key).filter((v): v is File => v instanceof File && v.size > 0);
				if (field.required && files.length === 0) errors[key] = [`${field.label} wajib diisi.`];
				if (files.length > 5) errors[key] = ["Maksimal 5 file per pertanyaan."];
				for (const file of files) {
					if (file.size > MAX_FILE_SIZE) errors[key] = [`Ukuran ${file.name} melebihi 10MB.`];
					if (!ALLOWED_EXTENSIONS.includes(fileExtension(file.name))) {
						errors[key] = [`Format ${file.name} tidak didukung.`];
					}
					uploads.push({ fieldId: field.id, file });
				}
				continue;
			}

			const values = formData
				.getAll(key)
				.filter((v): v is string => typeof v === "string")
				.map((v) => v.trim())
				.filter(Boolean);
			if (field.required && values.length === 0) {
				errors[key] = [`${field.label} wajib diisi.`];
				continue;
			}
			if (values.length === 0) continue;

			const options = parseFieldOptions(field.options);
			if (["multiple_choice", "dropdown", "linear_scale"].includes(type) && values.length !== 1) {
				errors[key] = ["Pilih satu jawaban."];
				continue;
			}
			if (CHOICE_FIELD_TYPES.includes(type as never) || type === "linear_scale") {
				const allowed = Array.isArray(options) ? options : options && typeof options === "object"
					? Array.from({ length: (options as { max: number; min: number }).max - (options as { max: number; min: number }).min + 1 },
						(_, i) => String((options as { min: number }).min + i))
					: [];
				if (values.some((v) => !allowed.includes(v))) {
					errors[key] = ["Pilihan tidak valid."];
					continue;
				}
			}
			if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[0])) {
				errors[key] = ["Alamat email tidak valid."];
				continue;
			}
			if (type === "number" && !/^-?\d+(?:\.\d+)?$/.test(values[0])) {
				errors[key] = ["Masukkan angka saja."];
				continue;
			}
			if (type === "date" && Number.isNaN(Date.parse(values[0]))) {
				errors[key] = ["Tanggal tidak valid."];
				continue;
			}
			const maxLength = type === "paragraph" ? MAX_TEXT_LENGTH : 500;
			if (values.some((v) => v.length > maxLength)) {
				errors[key] = [`Jawaban terlalu panjang (maksimal ${maxLength} karakter).`];
				continue;
			}

			answers.push({
				fieldId: field.id,
				fieldLabel: field.label,
				fieldType: field.type,
				value: JSON.stringify(type === "checkboxes" ? values : values[0]),
			});
		}

		if (Object.keys(errors).length) {
			throw ApiError.validation("Periksa kembali jawaban kamu.", errors);
		}

		const ip = c.req.header("cf-connecting-ip") ?? "unknown";
		const fingerprintBytes = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(`bph-cms:${ip}:${c.req.header("user-agent") ?? ""}`),
		);
		const fingerprint = Array.from(new Uint8Array(fingerprintBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");

		const now = new Date().toISOString();
		const [submission] = await db
			.insert(formSubmissions)
			.values({ id: uuidv7(), formId: form.id, fingerprint, createdAt: now, updatedAt: now })
			.returning();

		// D1 batch: atomik — jawaban sekali jalan.
		if (answers.length) {
			await c.env.DB.batch(
				answers.map((a) =>
					c.env.DB.prepare(
						"INSERT INTO form_answers (id, submission_id, field_id, field_label, field_type, value, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
					).bind(uuidv7(), submission.id, a.fieldId, a.fieldLabel, a.fieldType, a.value, now),
				),
			);
		}

		const uploadedPaths: string[] = [];
		try {
			for (const { fieldId, file } of uploads) {
				const ext = fileExtension(file.name) || "bin";
				const path = `forms/${form.id}/submissions/${submission.id}/${crypto.randomUUID()}.${ext}`;
				const mimeType = file.type || "application/octet-stream";
				await c.env.BUCKET.put(path, file.stream(), { httpMetadata: { contentType: mimeType } });
				uploadedPaths.push(path);
				await c.env.DB.prepare(
					"INSERT INTO form_files (id, submission_id, field_id, storage_path, original_filename, mime_type, file_size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
				)
					.bind(uuidv7(), submission.id, fieldId, path, file.name, mimeType, file.size, now)
					.run();
			}
		} catch (e) {
			// Rollback: hapus file yang sudah terlanjur naik + submission orphan.
			for (const p of uploadedPaths) await c.env.BUCKET.delete(p).catch(() => undefined);
			await c.env.DB.prepare("DELETE FROM form_submissions WHERE id = ?1").bind(submission.id).run();
			throw ApiError.server("Respons belum tersimpan. Silakan coba lagi.");
		}

		return ApiResponse.created(c, form.thankYouMessage, { submission_id: submission.id });
	},
);

// Pastikan kontrak tipe field terpakai di compile (jaga sinkron dengan advo).
void FORM_FIELD_TYPES;
