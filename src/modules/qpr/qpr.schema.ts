import { z } from "zod";

export const qprQuestionSchema = z.object({
	label: z.string().min(1).max(300),
	category: z.string().min(1).max(100),
});
export type QprQuestion = z.infer<typeof qprQuestionSchema>;
const legacyQuestionsSchema = z.array(qprQuestionSchema).min(1).max(50).refine(
	questions => new Set(questions.map(q => JSON.stringify([q.label, q.category]))).size === questions.length,
	"Pasangan label/kategori pertanyaan tidak boleh berulang",
);

// ── Snapshot berversi (form_kind bph/division) ──────────────────────────────
// Kuesioner BPH: 7 section × (20 skala + 2 teks) ≈ 154 pertanyaan → batas
// legacy 50 pertanyaan/300 karakter tidak memuat. Ini schema kolom DB baru,
// bukan pengganti qprQuestionSchema (legacy tetap jalan).

export const snapshotQuestionSchema = z.object({
	id: z.string().min(1).max(200),
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

// ── Snapshot v4: kategori pertanyaan + routing organisasi ──────────────────
// QPR penilaian 360°: bank kategori berisi pertanyaan (skala 1–5 atau esai)
// yang ditulis BPH sekali, lalu dipakai untuk menilai banyak orang.
//
// Pemisahan ini yang membuat form "ideal":
//   categories = APA yang ditanyakan (Kepemimpinan, Komunikasi, Kedisiplinan…)
//   roster     = SIAPA yang menilai dan SIAPA yang dinilai (qpr_entries)
//   routing    = dihitung server dari jabatan pengisi + divisinya (bukan data)
// Dengan begitu tidak ada entri ganda: satu impor roster menentukan siapa
// menilai siapa, dan pertanyaan otomatis muncul di tiap langkah target.

export const QPR_TARGET_KINDS = [
	"president",
	"vice_president",
	"controller",
	"secretary_general",
	"treasurer_general",
	"division_head",
	"deputy_head",
	"division_secretary",
	"division_treasurer",
	"member",
] as const;
export type QprTargetKind = (typeof QPR_TARGET_KINDS)[number];

export const qprCategorySchema = z.object({
	id: z.string().min(1).max(100),
	title: z.string().trim().min(1).max(300),
	// all = ditanyakan untuk semua target; positions = hanya target jabatan
	// (bukan anggota), supaya kadiv tidak menulis esai panjang per anggota.
	scope: z.enum(["all", "positions"]).default("all"),
	questions: z.array(snapshotQuestionSchema).max(100).default([]),
});
export type QprCategory = z.infer<typeof qprCategorySchema>;

export const questionnaireV4Schema = z.object({
	version: z.literal(4),
	categories: z.array(qprCategorySchema).min(1).max(20),
});
export type QuestionnaireV4 = z.infer<typeof questionnaireV4Schema>;

/** Satu langkah pengisian = satu orang yang dinilai. */
export type TopicSection = {
	id: string;
	title: string;
	targetId: string;
	targetLabel: string;
	questions: Array<SnapshotQuestion & { category: string; category_id: string }>;
};

/** Jabatan roster v4 (rubrik 360°). Legacy tetap memakai QPR_ROLES. */
export const QPR_V4_ROLES = [
	"president",
	"vice_president",
	"controller",
	"sekum",
	"bendum",
	"kadiv",
	"wakadiv",
	"sekdiv",
	"bendiv",
	"anggota",
] as const;
export type QprV4Role = (typeof QPR_V4_ROLES)[number];

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

/** Parse legacy/v2/v3/v4 without changing historical routes. */
export const parseQuestions = (raw: string | null): QuestionnaireSnapshot | QuestionnaireV4 | QprQuestion[] | null => {
	if (!raw) return null;
	const parsed = JSON.parse(raw);
	if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.version === 2) {
		return questionnaireV2Schema.parse(parsed);
	}
	if (parsed?.version === 3) return questionnaireV3Schema.parse(parsed);
	if (parsed?.version === 4) return questionnaireV4Schema.parse(parsed);
	return z.array(qprQuestionSchema).parse(parsed);
};

/** Input kategori pertanyaan saat membuat periode v4 — ID dibuat server. */
export const topicCategoryInputSchema = z.object({
	title: z.string().trim().min(1).max(300),
	scope: z.enum(["all", "positions"]).default("all"),
	questions: z
		.array(
			z.object({
				type: z.enum(["scale", "text"]),
				label: z.string().trim().min(1).max(2000),
				required: z.boolean().default(true),
			}),
		)
		.max(100)
		.default([]),
});
export type TopicCategoryInput = z.infer<typeof topicCategoryInputSchema>;

export const createPeriodSchema = z.object({
	form_kind: z.enum(["legacy", "bph", "division"]).default("legacy").nullish(),
	title: z.string().min(1).max(200),
	description: z.string().max(500).nullish(),
	// Satu periode QPR = satu divisi (opsional; null = periode lama/lintas).
	division_slug: z.enum(QPR_DIVISIONS).nullish(),
	// form bph: pertanyaan dibentuk dari template resmi server — klien tidak
	// mengirim questions. legacy/division: wajib.
	questions: legacyQuestionsSchema.nullish(),
	categories: z.array(topicCategoryInputSchema).max(20).nullish(),
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

// Write validation stays separate from historical snapshot parsing.
const stableIdSchema = z.string().min(1).max(100).regex(/^\S+$/);
const editableQuestionSchema = snapshotQuestionSchema.extend({
	id: stableIdSchema,
	label: z.string().trim().min(1).max(2000),
}).strict();
export const editableSectionSchema = snapshotSectionSchema.extend({
	id: stableIdSchema,
	title: z.string().trim().min(1).max(300),
	targetId: stableIdSchema,
	targetLabel: z.string().max(200).nullish(),
	questions: z.array(editableQuestionSchema).min(1).max(100),
}).strict();
// Kategori (v4): boleh belum punya pertanyaan saat masih draft — membuka
// periode tetap diblokir lewat preview sampai tiap kategori terisi.
export const editableCategorySchema = z.object({
	id: stableIdSchema,
	title: z.string().trim().min(1).max(300),
	scope: z.enum(["all", "positions"]).default("all"),
	questions: z.array(editableQuestionSchema).max(100),
}).strict();
export const editableTargetSchema = z.object({
	id: stableIdSchema,
	label: z.string().trim().min(1).max(200),
	kind: z.enum(QPR_TARGET_KINDS),
	divisionSlug: z.string().max(60).nullish(),
	manages: z.array(z.string().max(60)).max(8).default([]),
	memberKey: z.string().max(100).nullish(),
}).strict();
export const updatePeriodSchema = createPeriodSchema.partial().extend({
	form_kind: z.enum(["legacy", "bph", "division"]).nullish(),
	question_labels: z.record(stableIdSchema, z.string().trim().min(1).max(2000)).optional(),
	sections: z.array(editableSectionSchema).min(1).max(10).optional(),
	categories: z.array(editableCategorySchema).min(1).max(20).optional(),
	expected_snapshot: z.union([questionnaireV3Schema, questionnaireV4Schema]).optional(),
}).strict().superRefine((input, ctx) => {
	const v4Edit = input.categories !== undefined;
	if (input.sections !== undefined && input.expected_snapshot === undefined)
		ctx.addIssue({ code: "custom", path: ["expected_snapshot"], message: "Baseline snapshot wajib untuk perubahan sections" });
	if (v4Edit && input.expected_snapshot === undefined)
		ctx.addIssue({ code: "custom", path: ["expected_snapshot"], message: "Baseline snapshot wajib untuk perubahan kategori" });
	if (input.expected_snapshot !== undefined && input.sections === undefined && !v4Edit)
		ctx.addIssue({ code: "custom", path: ["expected_snapshot"], message: "Baseline hanya untuk perubahan struktur" });
	if (input.sections !== undefined && (input.question_labels !== undefined || input.questions !== undefined || v4Edit))
		ctx.addIssue({ code: "custom", path: ["sections"], message: "sections tidak boleh digabung dengan questions/question_labels/kategori" });
	if (v4Edit && (input.question_labels !== undefined || input.questions !== undefined || input.target_config !== undefined))
		ctx.addIssue({ code: "custom", path: ["categories"], message: "kategori tidak boleh digabung dengan questions/target_config" });
});
export type UpdatePeriodInput = z.infer<typeof updatePeriodSchema>;

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
				// Khusus v4: divisi yang diurus controller (1–3 divisi, boleh beda).
				manages: z.array(z.string().max(60)).max(8).optional(),
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
	answers: z.array(draftAnswerSchema).max(500),
});
export type SubmitV2Input = z.infer<typeof submitV2Schema>;
