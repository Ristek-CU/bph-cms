import { z } from "zod";

// Kontrak tipe field identik dengan campaign AdvocationDashboard — komponen form
// landing page memvalidasi dengan schema yang sama.
export const FORM_FIELD_TYPES = [
	"short_text",
	"paragraph",
	"email",
	"number",
	"multiple_choice",
	"checkboxes",
	"dropdown",
	"linear_scale",
	"date",
	"file",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const CHOICE_FIELD_TYPES: FormFieldType[] = [
	"multiple_choice",
	"checkboxes",
	"dropdown",
];

export const FORM_FIELD_LABELS: Record<FormFieldType, string> = {
	short_text: "Jawaban singkat",
	paragraph: "Paragraf",
	email: "Email",
	number: "Angka",
	multiple_choice: "Pilihan ganda / Polling",
	checkboxes: "Kotak centang",
	dropdown: "Dropdown",
	linear_scale: "Skala linear",
	date: "Tanggal",
	file: "Upload file",
};

// ISO datetime ATAU null — sama dengan kontrak event (offset wajib).
const isoDatetime = z
	.string()
	.refine(
		(v) => !Number.isNaN(Date.parse(v)) && /T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(v),
		"Must be ISO 8601 with offset (e.g. 2026-09-10T08:00:00+07:00)",
	);

export const fieldInputSchema = z.object({
	label: z.string().trim().min(1).max(300),
	description: z.string().max(1000).nullish(),
	type: z.enum(FORM_FIELD_TYPES),
	required: z.boolean().default(false),
	// Array pilihan utk choice types; {min,max} utk linear_scale. Diserialisasi
	// JSON.stringify ke kolom options (kontrak advo: string JSON).
	options: z.union([z.array(z.string().trim().min(1).max(300)).max(20), z.object({ min: z.number().int(), max: z.number().int() })]).nullish(),
	sort_order: z.number().int().min(0).max(999).default(0),
});
export type FieldInput = z.infer<typeof fieldInputSchema>;

export const createFormSchema = z
	.object({
		title: z.string().trim().min(1).max(200),
		slug: z
			.string()
			.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be kebab-case")
			.min(3)
			.max(120)
			.optional(),
		description: z.string().max(5000).nullish(),
		thank_you_message: z.string().trim().max(500).optional(),
		opens_at: isoDatetime.nullish(),
		closes_at: isoDatetime.nullish(),
		fields: z.array(fieldInputSchema).max(100).optional(),
	})
	.refine((v) => !v.opens_at || !v.closes_at || Date.parse(v.closes_at) > Date.parse(v.opens_at), {
		message: "closes_at must be after opens_at",
		path: ["closes_at"],
	});
export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = z
	.object({
		title: z.string().trim().min(1).max(200).optional(),
		description: z.string().max(5000).nullish(),
		thank_you_message: z.string().trim().max(500).optional(),
		opens_at: isoDatetime.nullish(),
		closes_at: isoDatetime.nullish(),
		// Jika fields dikirim → seluruh set pertanyaan diganti (pattern sessions di events).
		fields: z.array(fieldInputSchema).max(100).optional(),
	})
	.refine(
		(v) =>
			!v.opens_at ||
			!v.closes_at ||
			Date.parse(v.closes_at) > Date.parse(v.opens_at),
		{ message: "closes_at must be after opens_at", path: ["closes_at"] },
	);
export type UpdateFormInput = z.infer<typeof updateFormSchema>;

export const idParamSchema = z.object({ id: z.string().min(1) });

export const listSubmissionsQuerySchema = z.object({
	page: z.coerce.number().int().positive().default(1),
	per_page: z.coerce.number().int().positive().max(100).default(20),
});

export const updateSubmissionSchema = z.object({
	status: z.enum(["new", "reviewed", "archived"]),
});
