import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { ApiError } from "../../shared/api-error";
import { formAnswers, formFields, formSubmissions, forms } from "../../db/schema";
import type { Db } from "../../db/connection";
import type { CreateFormInput, FieldInput, UpdateFormInput } from "./form.schema";
import { CHOICE_FIELD_TYPES } from "./form.schema";

const slugify = (title: string) =>
	title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/[\s_]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 120) || "form";

// Sufiks -2..-N saat slug bentrok (pattern events.service).
const uniqueSlug = async (db: Db, base: string): Promise<string> => {
	const rows = await db
		.select({ slug: forms.slug })
		.from(forms)
		.where(sql`${forms.slug} = ${base} OR ${forms.slug} LIKE ${base + "-%"}`);
	const taken = new Set(rows.map((r) => r.slug));
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
};

export type FormRow = typeof forms.$inferSelect;
export type FieldRow = typeof formFields.$inferSelect;

export const formIsOpen = (f: { status: string; opensAt: string | null; closesAt: string | null }, now = new Date()): boolean => {
	if (f.status !== "published") return false;
	if (f.opensAt && new Date(f.opensAt) > now) return false;
	if (f.closesAt && new Date(f.closesAt) < now) return false;
	return true;
};

export const parseFieldOptions = (raw: string | null): unknown => {
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
};

const serializeOptions = (options: FieldInput["options"]): string | null =>
	options === undefined || options === null ? null : JSON.stringify(options);

const validateField = (f: FieldInput) => {
	if (CHOICE_FIELD_TYPES.includes(f.type)) {
		if (!f.options || !Array.isArray(f.options) || f.options.length < 2) {
			throw ApiError.validation("Validation failed", {
				fields: [`Field "${f.label}" (${f.type}) butuh minimal 2 opsi`],
			});
		}
	}
	if (f.type === "linear_scale") {
		const o = f.options as { min: number; max: number } | null | undefined;
		if (!o || typeof o !== "object" || o.min >= o.max || o.max - o.min > 10) {
			throw ApiError.validation("Validation failed", {
				fields: [`Field "${f.label}" (linear_scale) butuh options {min,max}, max rentang 10`],
			});
		}
	}
};

const toAdminShape = (f: FormRow, fields: FieldRow[] = []) => ({
	id: f.id,
	slug: f.slug,
	title: f.title,
	description: f.description,
	status: f.status,
	thank_you_message: f.thankYouMessage,
	background_color: f.backgroundColor,
	opens_at: f.opensAt,
	closes_at: f.closesAt,
	division_id: f.divisionId,
	created_at: f.createdAt,
	updated_at: f.updatedAt,
	fields: fields.map((d) => ({
		id: d.id,
		label: d.label,
		description: d.description,
		type: d.type,
		required: d.required,
		options: parseFieldOptions(d.options),
		sort_order: d.sortOrder,
	})),
});

const getWithFields = async (db: Db, id: string) => {
	const [form] = await db.select().from(forms).where(eq(forms.id, id)).limit(1);
	if (!form) return null;
	const fields = await db
		.select()
		.from(formFields)
		.where(eq(formFields.formId, id))
		.orderBy(asc(formFields.sortOrder));
	return { form, fields };
};

export const formService = {
	async listAdmin(db: Db, opts: { divisionId?: string; page?: number; perPage?: number }) {
		// Pagination opsional — default 200 (jumlah form per divisi jauh di bawah itu).
		const page = Math.max(1, opts.page ?? 1);
		const perPage = Math.min(200, Math.max(1, opts.perPage ?? 200));
		const scope = opts.divisionId ? eq(forms.divisionId, opts.divisionId) : undefined;
		const base = db.select().from(forms).orderBy(desc(forms.createdAt)).limit(perPage).offset((page - 1) * perPage);
		const rows = scope ? await base.where(scope) : await base;
		const [totalRow] = await db
			.select({ n: sql<number>`count(*)` })
			.from(forms)
			.where(scope ?? sql`1=1`);
		if (rows.length === 0) return { items: [], meta: { page, per_page: perPage, total: Number(totalRow?.n ?? 0) } };
		const ids = rows.map((r) => r.id);
		const allFields = await db.select().from(formFields).where(inArray(formFields.formId, ids)).orderBy(asc(formFields.sortOrder));
		// Jumlah respons per form untuk kartu studio (grouped, 1 query).
		const counts = await db
			.select({ formId: formSubmissions.formId, n: sql<number>`count(*)` })
			.from(formSubmissions)
			.where(inArray(formSubmissions.formId, ids))
			.groupBy(formSubmissions.formId);
		const countMap = new Map(counts.map((c) => [c.formId, Number(c.n)]));
		return {
			items: rows.map((r) => ({
				...toAdminShape(r, allFields.filter((d) => d.formId === r.id)),
				submission_count: countMap.get(r.id) ?? 0,
			})),
			meta: { page, per_page: perPage, total: Number(totalRow?.n ?? 0) },
		};
	},

	async get(db: Db, id: string) {
		const found = await getWithFields(db, id);
		if (!found) throw ApiError.notFound("Form tidak ditemukan");
		return toAdminShape(found.form, found.fields);
	},

	async create(db: Db, input: CreateFormInput, meta: { divisionId?: string; userId?: string }) {
		const slug = input.slug
			? (await uniqueSlug(db, input.slug), input.slug)
			: await uniqueSlug(db, slugify(input.title));

		for (const f of input.fields ?? []) validateField(f);

		const now = new Date().toISOString();
		const [row] = await db
			.insert(forms)
			.values({
				id: uuidv7(),
				divisionId: meta.divisionId!,
				slug,
				title: input.title,
				description: input.description ?? null,
				status: "draft",
				thankYouMessage: input.thank_you_message ?? "Terima kasih. Respons kamu sudah kami terima.",
				backgroundColor: input.background_color ?? "#F6F4EF",
				opensAt: input.opens_at ?? null,
				closesAt: input.closes_at ?? null,
				createdByUserId: meta.userId ?? null,
				updatedByUserId: meta.userId ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		if (input.fields?.length) await this.replaceFields(db, row.id, input.fields);
		return this.get(db, row.id);
	},

	// Ganti seluruh set pertanyaan (pattern sessions di events). Field lama yang
	// hilang dihapus; jawaban historis tetap punya snapshot label/type.
	async replaceFields(db: Db, formId: string, fields: FieldInput[]) {
		for (const f of fields) validateField(f);
		await db.delete(formFields).where(eq(formFields.formId, formId));
		const now = new Date().toISOString();
		await db.insert(formFields).values(
			fields.map((f, i) => ({
				id: uuidv7(),
				formId,
				label: f.label,
				description: f.description ?? null,
				type: f.type,
				required: f.required,
				options: serializeOptions(f.options),
				sortOrder: f.sort_order ?? i,
				createdAt: now,
				updatedAt: now,
			})),
		);
	},

	async update(db: Db, id: string, input: UpdateFormInput) {
		const existing = await getWithFields(db, id);
		if (!existing) throw ApiError.notFound("Form tidak ditemukan");

		const now = new Date().toISOString();
		await db
			.update(forms)
			.set({
				...(input.title !== undefined ? { title: input.title } : {}),
				...(input.description !== undefined ? { description: input.description ?? null } : {}),
				...(input.thank_you_message !== undefined ? { thankYouMessage: input.thank_you_message } : {}),
				...(input.background_color !== undefined ? { backgroundColor: input.background_color } : {}),
				...(input.opens_at !== undefined ? { opensAt: input.opens_at ?? null } : {}),
				...(input.closes_at !== undefined ? { closesAt: input.closes_at ?? null } : {}),
				updatedAt: now,
			})
			.where(eq(forms.id, id));

		if (input.fields !== undefined) await this.replaceFields(db, id, input.fields);
		return this.get(db, id);
	},

	async setStatus(db: Db, id: string, status: "published" | "draft" | "closed") {
		const [existing] = await db.select({ id: forms.id }).from(forms).where(eq(forms.id, id)).limit(1);
		if (!existing) throw ApiError.notFound("Form tidak ditemukan");
		const [row] = await db
			.update(forms)
			.set({ status, updatedAt: new Date().toISOString() })
			.where(eq(forms.id, id))
			.returning();
		return toAdminShape(row);
	},

	async delete(db: Db, id: string) {
		const [existing] = await db.select().from(forms).where(eq(forms.id, id)).limit(1);
		if (!existing) throw ApiError.notFound("Form tidak ditemukan");
		const count = await db.select({ n: sql<number>`count(*)` }).from(formSubmissions).where(eq(formSubmissions.formId, id));
		if (Number(count[0]?.n ?? 0) > 0) {
			throw ApiError.conflict("Form masih punya respons tersimpan. Tutup form, atau hapus respons dulu.");
		}
		await db.delete(forms).where(eq(forms.id, id));
		return existing;
	},

	// ---- Analytics ringkas per form (agregasi di SQL — aman untuk ribuan respons). ----
	async analytics(db: Db, formId: string) {
		const found = await getWithFields(db, formId);
		if (!found) throw ApiError.notFound("Form tidak ditemukan");

		// Tren 7 hari + total via GROUP BY di SQL — tidak load semua baris submission.
		const since = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
		const dayRows = await db
			.select({ day: sql<string>`substr(${formSubmissions.createdAt}, 1, 10)`, n: sql<number>`count(*)` })
			.from(formSubmissions)
			.where(and(eq(formSubmissions.formId, formId), sql`${formSubmissions.createdAt} >= ${since}`))
			.groupBy(sql`substr(${formSubmissions.createdAt}, 1, 10)`);
		const dayMap = new Map(dayRows.map((r) => [r.day, Number(r.n)]));

		const [totalRow] = await db
			.select({ n: sql<number>`count(*)` })
			.from(formSubmissions)
			.where(eq(formSubmissions.formId, formId));
		const total = Number(totalRow?.n ?? 0);

		const byDay = new Map<string, number>();
		for (let i = 6; i >= 0; i--) {
			const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
			byDay.set(d, dayMap.get(d) ?? 0);
		}

		const perField = found.fields.map((field) => ({
			id: field.id,
			label: field.label,
			type: field.type,
			response_rate: 0,
			distribution: null as Record<string, number> | null,
			average: null as number | null,
			recent: [] as unknown[],
		}));

		if (total > 0) {
			// Satu query untuk semua field: count + avg per field_id sekaligus —
			// dulu satu count + satu avg per field (N+1 saat field banyak).
			const statRows = await db
				.select({
					fieldId: formAnswers.fieldId,
					n: sql<number>`count(*)`,
					avg: sql<number | null>`avg(cast(json_extract(${formAnswers.value}, '$') as real))`,
				})
				.from(formAnswers)
				.where(
					inArray(
						formAnswers.fieldId,
						found.fields.map((f) => f.id),
					),
				)
				.groupBy(formAnswers.fieldId);
			const statMap = new Map(statRows.map((r) => [r.fieldId, r]));

			for (let i = 0; i < found.fields.length; i++) {
				const field = found.fields[i];
				const stat = statMap.get(field.id);
				perField[i].response_rate = Math.round((Number(stat?.n ?? 0) / total) * 100);

				const options = parseFieldOptions(field.options);
				if (Array.isArray(options)) {
					// Distribusi pilihan di SQL: GROUP BY value lalu pecah array (checkboxes) di JS.
					const distRows = await db
						.select({ value: formAnswers.value, n: sql<number>`count(*)` })
						.from(formAnswers)
						.where(eq(formAnswers.fieldId, field.id))
						.groupBy(formAnswers.value);
					const distribution: Record<string, number> = Object.fromEntries(
						(options as string[]).map((o) => [o, 0]),
					);
					for (const r of distRows) {
						const values = JSON.parse(r.value) as string | string[];
						for (const v of Array.isArray(values) ? values : [values]) {
							if (distribution[v] !== undefined) distribution[v] += Number(r.n);
						}
					}
					perField[i].distribution = distribution;
				}
				if (field.type === "linear_scale" || field.type === "number") {
					perField[i].average = stat?.avg != null ? Number(stat.avg) : 0;
				}
				const recentRows = await db
					.select({ value: formAnswers.value })
					.from(formAnswers)
					.where(eq(formAnswers.fieldId, field.id))
				.orderBy(desc(formAnswers.createdAt))
				.limit(5);
				perField[i].recent = recentRows.map((r) => JSON.parse(r.value));
			}
		}

		return {
			id: found.form.id,
			title: found.form.title,
			status: found.form.status,
			total_submissions: total,
			last_7_days: Array.from(byDay.entries()).map(([date, count]) => ({ date, count })),
			fields: perField,
		};
	},

	// ---- Submissions (admin divisi). ----
	async listSubmissions(db: Db, formId: string, page: number, perPage: number) {
		const [form] = await db.select({ id: forms.id, title: forms.title }).from(forms).where(eq(forms.id, formId)).limit(1);
		if (!form) throw ApiError.notFound("Form tidak ditemukan");
		const rows = await db
			.select()
			.from(formSubmissions)
			.where(eq(formSubmissions.formId, formId))
			.orderBy(desc(formSubmissions.createdAt))
			.limit(perPage)
			.offset((page - 1) * perPage);
		const answers = rows.length
			? await db.select().from(formAnswers).where(inArray(formAnswers.submissionId, rows.map((r) => r.id)))
			: [];
		const [totalRow] = await db
			.select({ n: sql<number>`count(*)` })
			.from(formSubmissions)
			.where(eq(formSubmissions.formId, formId));
		return {
			items: rows.map((r) => ({
				id: r.id,
				status: r.status,
				created_at: r.createdAt,
				answers: answers
					.filter((a) => a.submissionId === r.id)
					.map((a) => ({ field_id: a.fieldId, label: a.fieldLabel, type: a.fieldType, value: JSON.parse(a.value) })),
			})),
			meta: { page, per_page: perPage, total: Number(totalRow?.n ?? 0) },
		};
	},

	async updateSubmissionStatus(db: Db, submissionId: string, status: "new" | "reviewed" | "archived") {
		const [row] = await db
			.update(formSubmissions)
			.set({ status, updatedAt: new Date().toISOString() })
			.where(eq(formSubmissions.id, submissionId))
			.returning();
		if (!row) throw ApiError.notFound("Submission tidak ditemukan");
		return { id: row.id, status: row.status };
	},

	async deleteSubmission(db: Db, submissionId: string) {
		const [row] = await db.delete(formSubmissions).where(eq(formSubmissions.id, submissionId)).returning();
		if (!row) throw ApiError.notFound("Submission tidak ditemukan");
		return row;
	},

	async countSubmissions(db: Db, formId: string) {
		const [row] = await db
			.select({ n: sql<number>`count(*)` })
			.from(formSubmissions)
			.where(and(eq(formSubmissions.formId, formId)));
		return Number(row?.n ?? 0);
	},
};
