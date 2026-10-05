import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { ApiError } from "../../shared/api-error";
import { qprAnswers, qprEntries, qprPeriods } from "../../db/schema";
import { parseFieldOptions } from "../forms/form.service";
import type { Db } from "../../db/connection";
import type { QprQuestion, SubmitAnswersInput } from "./qpr.schema";
import type { DraftAnswer, SaveDraftInput, SnapshotQuestion, SubmitV2Input } from "./qpr.schema";
import { SCALE_LEGEND, buildBphSections, resolveBphPath, validateBphTemplate } from "./qpr.templates";


const periodIsOpen = (p: { status: string; opensAt: string | null; closesAt: string | null }) => {
	if (p.status !== "open") return false;
	// Bandingkan sebagai Date (pola formIsOpen) — perbandingan string ISO gagal saat
	// offset campur (+07:00 vs Z) karena urutan leksikografis.
	const now = new Date();
	if (p.opensAt && new Date(p.opensAt) > now) return false;
	if (p.closesAt && new Date(p.closesAt) < now) return false;
	return true;
};

// ── Draft & submit v2 (snapshot berversi) ───────────────────────────────────

type V2Period = { questions: string; formKind: string };

/** Parse snapshot v2 dari kolom questions; periode legacy → null. */
const parseV2 = (p: V2Period) => {
	if (p.formKind === "legacy") return null;
	const parsed = JSON.parse(p.questions);
	if (parsed?.version !== 2) return null;
	return parsed as { version: 2; sections: Array<{ id: string; title: string; targetId: string | null; targetLabel?: string | null; questions: SnapshotQuestion[] }> };
};

/**
 * Pertanyaan berlaku untuk satu jalur responden. Sumber tunggal bersama
 * preview/rekap — frontend tidak punya logika percabangan kedua.
 */
const resolveQuestions = (sections: NonNullable<ReturnType<typeof parseV2>>["sections"], targets: readonly string[]): SnapshotQuestion[] => {
	const wanted = new Set<string>(targets);
	return sections
		.filter((s) => s.targetId && wanted.has(s.targetId))
		.flatMap((s) => s.questions);
};

const wantedTarget = (targets: readonly string[], targetId: string) => targets.includes(targetId);

const validateDraftAnswers = (questions: SnapshotQuestion[], answers: DraftAnswer[]) => {
	const byId = new Map(questions.map((q) => [q.id, q]));
	const seen = new Set<string>();
	for (const a of answers) {
		const q = byId.get(a.question_id);
		if (!q) throw ApiError.validation("Jawaban tidak sesuai pertanyaan periode ini", { answers: [`ID tidak dikenal: ${a.question_id}`] });
		if (seen.has(a.question_id)) throw ApiError.validation("ID pertanyaan berulang", { answers: [a.question_id] });
		seen.add(a.question_id);
		if (q.type === "scale" && (typeof a.value !== "number" || !Number.isInteger(a.value) || a.value < 1 || a.value > 5)) {
			throw ApiError.validation("Skor skala harus 1-5", { answers: [a.question_id] });
		}
		if (q.type === "text") {
			if (typeof a.value !== "string") throw ApiError.validation("Jawaban teks harus string", { answers: [a.question_id] });
			if (a.value.trim().length > 5000) throw ApiError.validation("Jawaban teks maksimal 5000 karakter", { answers: [a.question_id] });
		}
	}
};

export const qprService = {
	async listPeriods(db: Db) {
		const periods = await db.select().from(qprPeriods).orderBy(asc(qprPeriods.title));
		if (!periods.length) return [];
		const counts = await db
			.select({ periodId: qprEntries.periodId, done: qprEntries.done })
			.from(qprEntries)
			.where(inArray(qprEntries.periodId, periods.map((p) => p.id)));
		return periods.map((p) => {
			const rows = counts.filter((c) => c.periodId === p.id);
			return {
				...p,
				questions: parseFieldOptions(p.questions),
				total_entries: rows.length,
				done_entries: rows.filter((r) => r.done).length,
			};
		});
	},

	async getPeriod(db: Db, id: string) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, id)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
		const entries = await db
			.select()
			.from(qprEntries)
			.where(eq(qprEntries.periodId, id))
			.orderBy(asc(qprEntries.name));
		return { ...period, questions: parseFieldOptions(period.questions), entries };
	},

	async createPeriod(db: Db, input: { title: string; description?: string | null; questions?: QprQuestion[] | null; form_kind?: "legacy" | "bph" | "division" | null; opens_at?: string | null; closes_at?: string | null; userId: string }) {
		const now = new Date().toISOString();
		const [existing] = await db.select({ id: qprPeriods.id }).from(qprPeriods).where(eq(qprPeriods.title, input.title)).limit(1);
		if (existing) throw ApiError.conflict("Periode dengan judul ini sudah ada");
		// form_kind bph = snapshot dari template resmi (bukan pertanyaan bebas
		// klien). Template rusak / target belum lengkap = blocker, bukan jalur kosong.
		let formKind: "legacy" | "bph" | "division" = input.form_kind ?? "legacy";
		let questionsJson: string;
		if (formKind === "bph") {
			const sections = buildBphSections();
			const errors = validateBphTemplate(sections);
			if (errors.length) throw ApiError.validation("Template QPR BPH tidak valid", { template: errors });
			questionsJson = JSON.stringify({ version: 2, sections });
		} else {
			if (!input.questions?.length) throw ApiError.validation("Pertanyaan wajib diisi untuk periode legacy/division");
			questionsJson = JSON.stringify(input.questions);
		}
		const [period] = await db
			.insert(qprPeriods)
			.values({
				id: uuidv7(),
				title: input.title,
				description: input.description ?? null,
				questions: questionsJson,
				formKind,
				status: "draft",
				opensAt: input.opens_at ?? null,
				closesAt: input.closes_at ?? null,
				createdByUserId: input.userId,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return { ...period, questions: formKind === "bph" ? { version: 2, sections: buildBphSections() } : input.questions };
	},

	async updatePeriod(db: Db, id: string, input: Partial<{ title: string; description: string | null; questions: QprQuestion[] | null; opens_at: string | null; closes_at: string | null; form_kind: "legacy" | "bph" | "division" | null }>) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, id)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
		if (period.status === "closed" && (input.questions || input.title)) {
			throw ApiError.conflict("Periode sudah ditutup — pertanyaan/judul tidak bisa diubah");
		}
		const now = new Date().toISOString();
		const [updated] = await db
			.update(qprPeriods)
			.set({
				...(input.title !== undefined ? { title: input.title } : {}),
				...(input.description !== undefined ? { description: input.description } : {}),
				...(input.questions !== undefined ? { questions: JSON.stringify(input.questions) } : {}),
				...(input.opens_at !== undefined ? { opensAt: input.opens_at } : {}),
				...(input.closes_at !== undefined ? { closesAt: input.closes_at } : {}),
				updatedAt: now,
			})
			.where(eq(qprPeriods.id, id))
			.returning();
		return { ...updated, questions: parseFieldOptions(updated.questions) };
	},

	async setStatus(db: Db, id: string, status: "draft" | "open" | "closed") {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, id)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
		if (period.status === status) return { ...period, questions: parseFieldOptions(period.questions) };
		const now = new Date().toISOString();
		const [updated] = await db.update(qprPeriods).set({ status, updatedAt: now }).where(eq(qprPeriods.id, id)).returning();
		return { ...updated, questions: parseFieldOptions(updated.questions) };
	},

	async deletePeriod(db: Db, id: string) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, id)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
		const answered = await db
			.select({ id: qprAnswers.id })
			.from(qprAnswers)
			.innerJoin(qprEntries, eq(qprAnswers.entryId, qprEntries.id))
			.where(eq(qprEntries.periodId, id))
			.limit(1);
		if (answered.length) throw ApiError.conflict("Periode masih punya penilaian tersimpan — rekap dulu sebelum menghapus");
		await db.delete(qprPeriods).where(eq(qprPeriods.id, id));
		return period;
	},

	async addEntries(db: Db, periodId: string, items: Array<{ name: string; division?: string | null; role?: string | null; division_slug?: string | null; member_key?: string | null }>) {
		const [period] = await db.select({ id: qprPeriods.id }).from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
		const existing = await db.select({ name: qprEntries.name }).from(qprEntries).where(eq(qprEntries.periodId, periodId));
		const taken = new Set(existing.map((e) => e.name.toLowerCase()));
		const dup = items.find((a) => taken.has(a.name.trim().toLowerCase()));
		if (dup) throw ApiError.conflict(`Nama "${dup.name}" sudah ada di daftar periode ini`);
		const now = new Date().toISOString();
		const rows = items.map((a) => ({
			id: uuidv7(),
			periodId,
			name: a.name,
			division: a.division ?? null,
			memberRole: a.role ?? null,
			divisionSlug: a.division_slug ?? null,
			memberKey: a.member_key ?? null,
			done: false,
			createdAt: now,
		}));
		await db.insert(qprEntries).values(rows);
		return rows;
	},

	async deleteEntry(db: Db, periodId: string, entryId: string) {
		const [row] = await db
			.select()
			.from(qprEntries)
			.where(and(eq(qprEntries.id, entryId), eq(qprEntries.periodId, periodId)))
			.limit(1);
		if (!row) throw ApiError.notFound("Nama tidak ditemukan");
		// Entry final menyimpan jawaban penilaian — cascade hapus jawaban lewat
		// penghapusan nama tidak boleh lewat jalur biasa.
		if (row.done) throw ApiError.conflict("Nama ini sudah mengisi penilaian — jawaban tidak boleh dihapus lewat sini");
		await db.delete(qprEntries).where(eq(qprEntries.id, entryId));
		return row;
	},

	/** Daftar publik untuk dropdown: hanya periode terbuka + nama yang BELUM done. */
	async publicRoster(db: Db, periodId: string) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period || !periodIsOpen(period)) throw ApiError.notFound("Periode penilaian tidak ditemukan atau sudah ditutup");
		const entries = await db
			.select({ id: qprEntries.id, name: qprEntries.name, division: qprEntries.division })
			.from(qprEntries)
			.where(and(eq(qprEntries.periodId, periodId), eq(qprEntries.done, false)))
			.orderBy(asc(qprEntries.name));
		return {
			id: period.id,
			title: period.title,
			description: period.description,
			status: period.status,
			isOpen: true,
			opens_at: period.opensAt,
			closes_at: period.closesAt,
			questions: parseFieldOptions(period.questions),
			remaining: entries,
		};
	},

	/** Submit publik: nama harus ada di roster & belum done. Sekali submit → done. */
	async submitPublic(db: Db, periodId: string, input: SubmitAnswersInput) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period || !periodIsOpen(period)) throw ApiError.notFound("Periode penilaian tidak ditemukan atau sudah ditutup");
		const entries = await db.select().from(qprEntries).where(eq(qprEntries.periodId, periodId));
		const entry = entries.find((e) => e.name.toLowerCase() === input.name.trim().toLowerCase());
		if (!entry) throw ApiError.validation("Nama tidak terdaftar", { name: ["Pilih nama dari daftar."] });
		// Jawaban harus cocok dengan pertanyaan periode — klien liar tidak bisa
		// menyuntik kategori/skor palsu ke rekap.
		const questions = (parseFieldOptions(period.questions) as QprQuestion[]) ?? [];
		const valid = new Set(questions.map((q) => `${q.label} ${q.category}`));
		if (input.answers.some((a) => !valid.has(`${a.label} ${a.category}`))) {
			throw ApiError.validation("Jawaban tidak sesuai pertanyaan periode ini", {
				answers: ["Label/kategori jawaban tidak dikenal."],
			});
		}
		// Klaim atomik: update done hanya jika masih false. Dua submit paralel dengan
		// nama sama — hanya satu yang dapat baris; yang lain 409. (Pola sama dengan
		// handoff exchange.)
		const now = new Date().toISOString();
		const claimed = await db
			.update(qprEntries)
			.set({ done: true, submittedAt: now })
			.where(and(eq(qprEntries.id, entry.id), eq(qprEntries.done, false)))
			.returning({ id: qprEntries.id });
		if (claimed.length === 0) throw ApiError.conflict("Nama ini sudah mengisi penilaian.");
		try {
			const stored = input.note ? [...input.answers, { label: "Catatan", category: "Catatan", score: 5, note: input.note }] : input.answers;
			await db.insert(qprAnswers).values({ id: uuidv7(), entryId: entry.id, answers: JSON.stringify(stored), submittedAt: now });
		} catch (e) {
			// Insert gagal → batalkan klaim done supaya pengisi bisa retry.
			// (Batch D1 tidak bisa kondisional antar-statement; rollback manual.)
			await db.update(qprEntries).set({ done: false, submittedAt: null }).where(eq(qprEntries.id, entry.id));
			throw e;
		}
		return { entry_id: entry.id, name: entry.name };
	},

	// ── Draft v2: server-side autosave, lanjut lintas perangkat cukup pilih nama ──

	/** GET draft: pertanyaan jalur + draft tersimpan + progres. Tanpa login (model kejuhuran). */
	async getDraft(db: Db, periodId: string, entryId: string) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period || !periodIsOpen(period)) throw ApiError.notFound("Periode penilaian tidak ditemukan atau sudah ditutup");
		const [entry] = await db.select().from(qprEntries).where(and(eq(qprEntries.id, entryId), eq(qprEntries.periodId, periodId))).limit(1);
		if (!entry) throw ApiError.notFound("Nama tidak ditemukan di periode ini");
		if (entry.done) throw ApiError.conflict("Nama ini sudah mengirim penilaian final.");
		const v2 = parseV2(period);
		if (!v2) throw ApiError.validation("Periode ini memakai format lama — draft tidak tersedia");
		// Jalur responden dari snapshot identitas roster; entry legacy tanpa
		// member_role diperlakukan anggota biasa (ketum+waketum).
		const role = (entry.memberRole ?? "anggota") as Parameters<typeof resolveBphPath>[0];
		const targets = resolveBphPath(role, { controllers: ["controller"], bendahara: ["bendum1"], sekretaris: ["sekum1"] });
		const questions = resolveQuestions(v2.sections, targets);
		const draft = entry.draftAnswers ? (parseFieldOptions(entry.draftAnswers) as DraftAnswer[]) : [];
		const requiredIds = new Set(questions.filter((q) => q.required).map((q) => q.id));
		const filled = draft.filter((a) => {
			const q = questions.find((x) => x.id === a.question_id);
			if (!q) return false;
			return q.type === "scale" ? typeof a.value === "number" : typeof a.value === "string" && a.value.trim().length > 0;
		});
		const nextUnanswered = questions.find((q) => q.required && !filled.some((f) => f.question_id === q.id));
		return {
			entry: { id: entry.id, name: entry.name, division: entry.division, role: entry.memberRole },
			sections: v2.sections.filter((s) => s.targetId && wantedTarget(targets, s.targetId)),
			questions,
			draft,
			draft_version: entry.draftVersion,
			draft_updated_at: entry.draftUpdatedAt,
			progress: {
				required: requiredIds.size,
				filled: filled.filter((f) => requiredIds.has(f.question_id)).length,
				next_question_id: nextUnanswered?.id ?? null,
			},
			scale_legend: SCALE_LEGEND,
		};
	},

	/** PUT draft: CAS — expected_version harus cocok, kalau tidak 409 (jangan timpa). */
	async saveDraft(db: Db, periodId: string, entryId: string, input: SaveDraftInput) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period || !periodIsOpen(period)) throw ApiError.notFound("Periode penilaian tidak ditemukan atau sudah ditutup");
		const [entry] = await db.select().from(qprEntries).where(and(eq(qprEntries.id, entryId), eq(qprEntries.periodId, periodId))).limit(1);
		if (!entry) throw ApiError.notFound("Nama tidak ditemukan di periode ini");
		if (entry.done) throw ApiError.conflict("Nama ini sudah mengirim penilaian final.");
		const v2 = parseV2(period);
		if (!v2) throw ApiError.validation("Periode ini memakai format lama — draft tidak tersedia");
		const role = (entry.memberRole ?? "anggota") as Parameters<typeof resolveBphPath>[0];
		const targets = resolveBphPath(role, { controllers: ["controller"], bendahara: ["bendum1"], sekretaris: ["sekum1"] });
		const questions = resolveQuestions(v2.sections, targets);
		validateDraftAnswers(questions, input.answers);
		const now = new Date().toISOString();
		const updated = await db
			.update(qprEntries)
			.set({ draftAnswers: JSON.stringify(input.answers), draftVersion: entry.draftVersion + 1, draftUpdatedAt: now })
			.where(and(eq(qprEntries.id, entryId), eq(qprEntries.done, false), eq(qprEntries.draftVersion, input.expected_version)))
			.returning({ id: qprEntries.id, draftVersion: qprEntries.draftVersion });
		if (!updated.length) throw ApiError.conflict("Draft sudah diperbarui perangkat lain — muat ulang sebelum menyimpan.");
		return { draft_version: updated[0].draftVersion, saved_at: now };
	},

	/**
	 * Submit final v2: exact-set lengkap, satu D1 batch atomik. Insert final
	 * bersyarat (WHERE done=false) jadi dasar — UPDATE done dan DELETE draft
	 * hanya jalan bila row operasi ini yang masuk. Dua submit paralel: satu
	 * insert, yang lain 409. Tidak ada keadaan setengah berhasil.
	 */
	async submitV2(db: Db, periodId: string, input: SubmitV2Input) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period || !periodIsOpen(period)) throw ApiError.notFound("Periode penilaian tidak ditemukan atau sudah ditutup");
		const [entry] = await db.select().from(qprEntries).where(and(eq(qprEntries.id, input.entry_id), eq(qprEntries.periodId, periodId))).limit(1);
		if (!entry) throw ApiError.notFound("Nama tidak ditemukan di periode ini");
		if (entry.done) throw ApiError.conflict("Nama ini sudah mengirim penilaian final.");
		const v2 = parseV2(period);
		if (!v2) throw ApiError.validation("Periode ini memakai format lama — gunakan submit lama");
		const role = (entry.memberRole ?? "anggota") as Parameters<typeof resolveBphPath>[0];
		const targets = resolveBphPath(role, { controllers: ["controller"], bendahara: ["bendum1"], sekretaris: ["sekum1"] });
		const questions = resolveQuestions(v2.sections, targets);
		validateDraftAnswers(questions, input.answers);
		// Exact set: semua wajib terisi, tidak ada di luar jalur, tidak berulang.
		const required = questions.filter((q) => q.required);
		const byId = new Map(input.answers.map((a) => [a.question_id, a]));
		const missing = required.filter((q) => {
			const a = byId.get(q.id);
			return !a || (q.type === "text" ? (typeof a.value !== "string" || !a.value.trim()) : typeof a.value !== "number");
		});
		if (missing.length) {
			throw ApiError.validation(`Jawaban wajib belum lengkap (${missing.length} kurang)`, { answers: missing.map((q) => q.id) });
		}
		const extra = input.answers.filter((a) => !questions.some((q) => q.id === a.question_id));
		if (extra.length) throw ApiError.validation("Jawaban di luar jalur responden", { answers: extra.map((a) => a.question_id) });

		const now = new Date().toISOString();
		const answerId = uuidv7();
		// Guard DB pada operasi, bukan cuma pengecekan sebelum batch. Tabel
		// qpr_answers hanya punya SATU unique constraint (entry_id) — jadi
		// onConflictDoNothing hanya pernah diam pada race final nama yang sama,
		// bukan menyembunyikan kegagalan lain (constraint lain tetap melempar).
		// UPDATE hanya jalan bila row final operasi INI yang masuk (EXISTS id
		// operasi), jadi yang kalah race tidak mengubah apa pun.
		const results = await db.batch([
			db.insert(qprAnswers)
				.values({ id: answerId, entryId: entry.id, answers: JSON.stringify(input.answers), submittedAt: now })
				.onConflictDoNothing({ target: qprAnswers.entryId }),
			db.update(qprEntries)
				.set({ done: true, submittedAt: now })
				.where(and(eq(qprEntries.id, entry.id), eq(qprEntries.done, false), sql`EXISTS (SELECT 1 FROM qpr_answers WHERE id = ${answerId})`)),
			db.update(qprEntries)
				.set({ draftAnswers: null, draftUpdatedAt: null })
				.where(and(eq(qprEntries.id, entry.id), sql`EXISTS (SELECT 1 FROM qpr_answers WHERE id = ${answerId})`)),
		]);
		// changes 0 pada insert = kalah race (sudah final) — bukan sukses diam.
		const inserted = (results[0] as unknown as { meta?: { changes?: number } })?.meta?.changes ?? 0;
		if (!inserted) throw ApiError.conflict("Nama ini sudah mengirim penilaian final.");
		return { entry_id: entry.id, name: entry.name, submitted_at: now };
	},

	/** Rekap: rata-rata skor per kategori + partisipasi (siapa sudah/belum). */
	/** Rekap v2: distribusi skor 1–5 + mean per pertanyaan, teks per target. Hanya final. */
	async recapV2(db: Db, periodId: string) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
		const v2 = parseV2(period);
		if (!v2) throw ApiError.validation("Periode ini memakai format lama — gunakan rekap lama");
		const entries = await db.select().from(qprEntries).where(eq(qprEntries.periodId, periodId));
		const doneEntries = entries.filter((e) => e.done);
		const answerRows = doneEntries.length
			? await db
					.select({ entryId: qprAnswers.entryId, answers: qprAnswers.answers })
					.from(qprAnswers)
					.where(inArray(qprAnswers.entryId, doneEntries.map((e) => e.id)))
			: [];
		// Skor terkumpul per question_id — hanya dari jalur responden yang
		// menilai target itu (denominator = jumlah jawaban final pertanyaan itu).
		const scores = new Map<string, number[]>();
		const texts = new Map<string, string[]>();
		for (const row of answerRows) {
			const parsed = JSON.parse(row.answers) as Array<{ question_id: string; value: number | string }>;
			for (const a of parsed) {
				if (typeof a.value === "number") {
					const list = scores.get(a.question_id) ?? [];
					list.push(a.value);
					scores.set(a.question_id, list);
				} else if (typeof a.value === "string" && a.value.trim()) {
					const list = texts.get(a.question_id) ?? [];
					list.push(a.value.trim());
					texts.set(a.question_id, list);
				}
			}
		}
		const sections = v2.sections.map((s) => ({
			id: s.id,
			title: s.title,
			target_id: s.targetId,
			target_label: s.targetLabel ?? null,
			questions: s.questions.map((q) => {
				if (q.type === "text") {
					const list = texts.get(q.id) ?? [];
					return { id: q.id, type: q.type, label: q.label, required: q.required, responses: list.length, texts: list };
				}
				const list = scores.get(q.id) ?? [];
				const dist = [1, 2, 3, 4, 5].map((v) => ({ value: v, count: list.filter((x) => x === v).length }));
				const mean = list.length ? Math.round((list.reduce((x, y) => x + y, 0) / list.length) * 100) / 100 : null;
				return { id: q.id, type: q.type, label: q.label, required: q.required, responses: list.length, distribution: dist, mean };
			}),
		}));
		return {
			period: { id: period.id, title: period.title, description: period.description, status: period.status, form_kind: period.formKind },
			total_entries: entries.length,
			done_entries: doneEntries.length,
			pending: entries.filter((e) => !e.done).map((e) => ({ id: e.id, name: e.name, division: e.division, role: e.memberRole ?? null })),
			sections,
		};
	},

	/** Ekspor CSV lebar: satu baris per submit final, kolom per pertanyaan jalur itu. */
	async exportCsv(db: Db, periodId: string) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
		const v2 = parseV2(period);
		if (!v2) throw ApiError.validation("Periode ini memakai format lama — ekspor belum didukung");
		const entries = await db.select().from(qprEntries).where(and(eq(qprEntries.periodId, periodId), eq(qprEntries.done, true)));
		const answerRows = entries.length
			? await db
					.select({ entryId: qprAnswers.entryId, answers: qprAnswers.answers, submittedAt: qprAnswers.submittedAt })
					.from(qprAnswers)
					.where(inArray(qprAnswers.entryId, entries.map((e) => e.id)))
			: [];
		const byEntry = new Map(answerRows.map((r) => [r.entryId, r]));
		// Header = superset kolom semua jalur; kolom tak berlaku untuk responden kosong.
		const header = v2.sections.flatMap((s) => s.questions.map((q) => [s.targetLabel || s.title, q.id, q.label] as const));
		const escape = (v: unknown) => {
			// Formula injection: awalan = + - @ tab/CR di-prefix ' agar Excel
			// memperlakukan sebagai teks, bukan formula.
			const s = String(v ?? "");
			const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
			return `"${safe.replace(/"/g, '""')}"`;
		};
		const lines = [
			["waktu_kirim", "nama", "divisi", "jabatan", ...header.map(([, qid]) => qid)].map(escape).join(","),
			...entries.map((e) => {
				const row = byEntry.get(e.id);
				const answers = row ? (JSON.parse(row.answers) as Array<{ question_id: string; value: number | string }>) : [];
				const byId = new Map(answers.map((a) => [a.question_id, a.value]));
				return [
					row?.submittedAt ?? e.submittedAt ?? "",
					e.name,
					e.division ?? "",
					e.memberRole ?? "",
					...header.map(([, qid]) => byId.get(qid) ?? ""),
				].map(escape).join(",");
			}),
		];
		return { filename: `qpr-${period.id.slice(0, 8)}.csv`, csv: lines.join("\r\n") };
	},

	async recap(db: Db, periodId: string) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
		const entries = await db.select().from(qprEntries).where(eq(qprEntries.periodId, periodId));
		const answerRows = entries.length
			? await db
					.select({ entryId: qprAnswers.entryId, answers: qprAnswers.answers })
					.from(qprAnswers)
					.where(inArray(qprAnswers.entryId, entries.map((e) => e.id)))
			: [];
		const byEntry = new Map(answerRows.map((r) => [r.entryId, r.answers]));
		const doneEntries = entries.filter((e) => e.done);
		const categories = new Map<string, number[]>();
		const notes: string[] = [];
		for (const e of doneEntries) {
			const parsed = (parseFieldOptions(byEntry.get(e.id) ?? null) as Array<{ label?: string; category?: string; score?: number; note?: string }>) ?? [];
			for (const a of parsed) {
				// Entri "Catatan" = catatan bebas tingkat jawaban (skor 5 hanyalah
				// pengisi) — bukan penilaian, jangan ikut merata-ratakan.
				if (a.label === "Catatan") {
					if (a.note) notes.push(a.note);
					continue;
				}
				if (typeof a.score === "number" && typeof a.category === "string") {
					const list = categories.get(a.category) ?? [];
					list.push(a.score);
					categories.set(a.category, list);
				}
				if (a.note) notes.push(a.note);
			}
		}
		const categoryAverages: Record<string, number> = {};
		for (const [cat, list] of categories) {
			categoryAverages[cat] = Math.round((list.reduce((x, y) => x + y, 0) / list.length) * 100) / 100;
		}
		const allScores = Array.from(categories.values()).flat();
		return {
			period: { id: period.id, title: period.title, description: period.description, status: period.status },
			total_entries: entries.length,
			done_entries: doneEntries.length,
			pending: entries.filter((e) => !e.done).map((e) => ({ name: e.name, division: e.division })),
			category_averages: categoryAverages,
			overall_average: allScores.length ? Math.round((allScores.reduce((x, y) => x + y, 0) / allScores.length) * 100) / 100 : null,
			notes,
		};
	},
};
