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

export const QPR_DIVISIONS = ["bph", "ristek", "ukm", "advo", "bnp", "icd", "pr", "media"] as const;
export const QPR_ROLES = ["anggota", "controller", "sekum", "bendum", "kadiv", "wakadiv", "bendiv", "sekdiv"] as const;
export const targetConfigSchema = z.object({
	targets: z.array(z.object({
		id: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/),
		label: z.string().trim().max(200),
		template: z.enum(["controller", "bendum1", "bendum2", "sekum1", "sekum2", "ketum", "waketum"]),
	})).max(10),
	controller_by_division: z.record(z.string(), z.string().max(60)),
});
export type TargetConfig = z.infer<typeof targetConfigSchema>;
export const questionnaireV3Schema = z.object({
	version: z.literal(3),
	sections: z.array(snapshotSectionSchema).max(10),
	target_config: targetConfigSchema,
	routing: z.record(z.string(), z.array(z.string())),
});
export type QuestionnaireV3 = z.infer<typeof questionnaireV3Schema>;
export type QuestionnaireSnapshot = QuestionnaireV2 | QuestionnaireV3;

/** Parse legacy/v2/v3 without changing historical routes. */
export const parseQuestions = (raw: string | null): QuestionnaireSnapshot | QprQuestion[] | null => {
	if (!raw) return null;
	const parsed = JSON.parse(raw);
	if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.version === 2) {
		return questionnaireV2Schema.parse(parsed);
	}
	if (parsed?.version === 3) return questionnaireV3Schema.parse(parsed);
	return z.array(qprQuestionSchema).parse(parsed);
};

export const createPeriodSchema = z.object({
	form_kind: z.enum(["legacy", "bph", "division"]).default("legacy").nullish(),
	title: z.string().min(1).max(200),
	description: z.string().max(500).nullish(),
	// form bph: pertanyaan dibentuk dari template resmi server — klien tidak
	// mengirim questions. legacy/division: wajib.
	questions: z.array(qprQuestionSchema).min(1).max(50).nullish(),
	target_config: targetConfigSchema.optional(),
	opens_at: z
		.string()
		.datetime({ offset: true })
		.nullish(),
	closes_at: z
		.string()
		.datetime({ offset: true })
		.nullish(),
});
export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;

export const updatePeriodSchema = createPeriodSchema.partial().extend({ form_kind: z.enum(["legacy", "bph", "division"]).nullish() });

export const createEntriesSchema = z.object({
	entries: z
		.array(
			z.object({
				name: z.string().min(1).max(200),
				division: z.string().max(200).nullish(),
				// Snapshot identitas roster (jabatan organisasi, bukan role CMS).
				role: z.string().max(100).nullish(),
				division_slug: z.string().max(100).nullish(),
				// ID anggota stabil — pembeda nama kembar; dibuat sistem bila kosong.
				member_key: z.string().max(100).nullish(),
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

// ── Draft (snapshot v2, model kejuhuran: cukup pilih nama) ──────────────────

export const draftAnswerSchema = z.object({
	question_id: z.string().min(1).max(100),
	// scale = int 1-5; text = string maks 5000 (whitespace-only = belum dianggap isi).
	value: z.union([z.number().int().min(1).max(5), z.string().max(5000)]),
});
export type DraftAnswer = z.infer<typeof draftAnswerSchema>;

export const saveDraftSchema = z.object({
	expected_version: z.number().int().min(0),
	answers: z.array(draftAnswerSchema).max(500),
});
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export const submitV2Schema = z.object({
	entry_id: z.string().min(1).max(100),
	expected_version: z.number().int().min(0).nullish(),
	answers: z.array(draftAnswerSchema).min(1).max(500),
});
export type SubmitV2Input = z.infer<typeof submitV2Schema>;
