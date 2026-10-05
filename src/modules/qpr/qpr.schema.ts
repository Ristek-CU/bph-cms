import { z } from "zod";

export const qprQuestionSchema = z.object({
	label: z.string().min(1).max(300),
	category: z.string().min(1).max(100),
});
export type QprQuestion = z.infer<typeof qprQuestionSchema>;

// ── Snapshot berversi (form_kind bph/division) ──────────────────────────────
// Kuesioner BPH: 7 section × (20 skala + 2 teks) ≈ 154 pertanyaan → batas
// legacy 50 pertanyaan/300 karakter tidak memuat. Ini schema kolom DB baru,
// bukan pengganti qprQuestionSchema (legacy tetap jalan).

export const snapshotQuestionSchema = z.object({
	id: z.string().min(1).max(100),
	type: z.enum(["scale", "text"]),
	label: z.string().min(1).max(2000),
	required: z.boolean().default(true),
});
export type SnapshotQuestion = z.infer<typeof snapshotQuestionSchema>;

export const snapshotSectionSchema = z.object({
	id: z.string().min(1).max(100),
	title: z.string().min(1).max(300),
	// Target penilaian section, mis. "ketum", "bendum1". Null = section routing/identitas.
	targetId: z.string().max(100).nullable().default(null),
	targetLabel: z.string().max(200).nullish(),
	questions: z.array(snapshotQuestionSchema).min(1).max(100),
});
export type SnapshotSection = z.infer<typeof snapshotSectionSchema>;

export const questionnaireV2Schema = z.object({
	version: z.literal(2),
	sections: z.array(snapshotSectionSchema).min(1).max(20),
});
export type QuestionnaireV2 = z.infer<typeof questionnaireV2Schema>;

/** Parse kolom questions: snapshot v2 atau array legacy [{label, category}]. */
export const parseQuestions = (raw: string | null): QuestionnaireV2 | QprQuestion[] | null => {
	if (!raw) return null;
	const parsed = JSON.parse(raw);
	if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.version === 2) {
		return questionnaireV2Schema.parse(parsed);
	}
	return z.array(qprQuestionSchema).parse(parsed);
};

export const createPeriodSchema = z.object({
	form_kind: z.enum(["legacy", "bph", "division"]).default("legacy").nullish(),
	title: z.string().min(1).max(200),
	description: z.string().max(500).nullish(),
	questions: z.array(qprQuestionSchema).min(1).max(50),
	opens_at: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/)
		.nullish(),
	closes_at: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/)
		.nullish(),
});
export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;

export const updatePeriodSchema = createPeriodSchema.partial();

export const createEntriesSchema = z.object({
	entries: z
		.array(
			z.object({
				name: z.string().min(1).max(200),
				division: z.string().max(200).nullish(),
			}),
		)
		.min(1)
		.max(500),
});

export const submitAnswersSchema = z.object({
	name: z.string().min(1).max(200),
	answers: z
		.array(
			z.object({
				label: z.string().min(1).max(300),
				category: z.string().min(1).max(100),
				score: z.number().int().min(1).max(5),
				note: z.string().max(2000).nullish(),
			}),
		)
		.min(1)
		.max(50),
	// Catatan bebas tingkat jawaban (opsional) — field terpisah, bukan jawaban
	// palsu, supaya lolos validasi label/kategori.
	note: z.string().max(2000).nullish(),
});
export type SubmitAnswersInput = z.infer<typeof submitAnswersSchema>;
