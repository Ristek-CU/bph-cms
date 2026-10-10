import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { ApiError } from "../../shared/api-error";
import { divisions, qprAnswers, qprEntries, qprPeriods } from "../../db/schema";
import { parseFieldOptions } from "../forms/form.service";
import type { Db } from "../../db/connection";
import { parseQuestions, createPeriodSchema, updatePeriodSchema, QPR_DIVISIONS, QPR_ROLES, type UpdatePeriodInput, type TargetConfig, type QprQuestion, type SubmitAnswersInput } from "./qpr.schema";
import type { DraftAnswer, SaveDraftInput, SnapshotQuestion, SubmitV2Input } from "./qpr.schema";
import { BPH_TARGETS, SCALE_LEGEND, buildBphSections, buildBphSnapshot, resolveSnapshotPath, validateSnapshotMutation, validateTargetConfig, validateBphTemplate } from "./qpr.templates";


const snapshotKey = (value: unknown) => JSON.stringify(value, (_, v) =>
 v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

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

const parseV2 = (p: V2Period) => {
 const parsed = parseQuestions(p.questions);
 return parsed && !Array.isArray(parsed) ? parsed : null;
};
const pathFor = (snapshot: NonNullable<ReturnType<typeof parseV2>>, entry: typeof qprEntries.$inferSelect) => {
 try { return resolveSnapshotPath(snapshot, entry); }
 catch (error) { throw ApiError.validation((error as Error).message); }
};
const displayName = (e: { name: string; division?: string | null; memberRole?: string | null; id?: string }) =>
 `${e.name} — ${e.division ?? "Perlu pemetaan"} / ${e.memberRole ?? "anggota"}${e.id ? ` (${e.id.slice(-8)})` : ""}`;
const finalConflict = () => new ApiError(409, "Nama ini sudah mengirim penilaian final.", { code: "QPR_ALREADY_FINAL", state: ["already_final"] });
const draftConflict = () => new ApiError(409, "Draft sudah diperbarui perangkat lain — muat ulang sebelum menyimpan.", { code: "QPR_DRAFT_CONFLICT", state: ["draft_conflict"] });
const openSql = sql`EXISTS (SELECT 1 FROM qpr_periods p WHERE p.id = ${qprEntries.periodId} AND p.status = 'open'
 AND (p.opens_at IS NULL OR julianday(p.opens_at) <= julianday('now'))
 AND (p.closes_at IS NULL OR julianday(p.closes_at) >= julianday('now')))`;
const validateSchedule = (opens?: string | null, closes?: string | null) => {
 if ([opens, closes].some((v) => v && !Number.isFinite(Date.parse(v)))) throw ApiError.validation("Tanggal tidak valid");
 if (opens && closes && Date.parse(opens) > Date.parse(closes)) throw ApiError.validation("Jadwal tutup harus setelah buka");
};
async function writeConflict(db: Db, periodId: string, entryId: string): Promise<never> {
 const [e] = await db.select({ done: qprEntries.done }).from(qprEntries).where(eq(qprEntries.id, entryId));
 if (e?.done) throw finalConflict();
 const [p] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId));
 if (!p || !periodIsOpen(p)) throw ApiError.notFound("Periode penilaian tidak ditemukan atau sudah ditutup");
 throw draftConflict();
}
async function insertFinal(db: Db, periodId: string, entry: typeof qprEntries.$inferSelect, answers: unknown, version: number | null) {
 const now = new Date().toISOString();
 const answerId = uuidv7();
 const client = (db as Db & { $client: D1Database }).$client;
 const results = await client.batch([
  client.prepare(`INSERT INTO qpr_answers (id, entry_id, answers, submitted_at)
   SELECT ?, e.id, ?, ? FROM qpr_entries e JOIN qpr_periods p ON p.id = e.period_id
   WHERE e.id = ? AND p.id = ? AND e.done = 0 AND (? IS NULL OR e.draft_version = ?)
   AND p.status = 'open' AND (p.opens_at IS NULL OR julianday(p.opens_at) <= julianday('now'))
   AND (p.closes_at IS NULL OR julianday(p.closes_at) >= julianday('now'))
   ON CONFLICT(entry_id) DO NOTHING`).bind(answerId, JSON.stringify(answers), now, entry.id, periodId, version, version),
  client.prepare(`UPDATE qpr_entries SET done = 1, submitted_at = ?, draft_answers = NULL, draft_updated_at = NULL
   WHERE id = ? AND EXISTS (SELECT 1 FROM qpr_answers WHERE id = ? AND entry_id = qpr_entries.id)`).bind(now, entry.id, answerId),
 ]);
 if (!results[0].meta.changes) return writeConflict(db, periodId, entry.id);
 return { entry_id: entry.id, name: entry.name, submitted_at: now };
}

// Target non-controller wajib ada — sumber tunggal dari BPH_TARGETS (templates).
const BPH_FIXED_TARGETS = BPH_TARGETS.filter(({ id }) => id !== "controller").map(({ id }) => id);

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
    async preview(db: Db, periodId: string) {
        const period = await this.getPeriod(db, periodId);
        const canonical = await db.select({ slug: divisions.slug, name: divisions.name }).from(divisions).where(inArray(divisions.slug, [...QPR_DIVISIONS]));
        const snapshot = parseV2({ questions: JSON.stringify(period.questions), formKind: period.formKind });
        const blockers: string[] = [];
        if (snapshot?.version === 3) {
            blockers.push(...validateTargetConfig(snapshot.target_config));
            if (snapshot.target_config.targets.filter((t) => t.template === "controller").length !== 4) blockers.push("Empat Controller wajib dikonfigurasi");
            for (const t of BPH_FIXED_TARGETS) {
                if (!snapshot.target_config.targets.some((x) => x.id === t && x.template === t)) blockers.push(`Target wajib: ${t}`);
            }
            for (const t of snapshot.target_config.targets) if (!t.label.trim()) blockers.push(`Nama target belum diisi: ${t.id}`);
            if (!period.entries.length) blockers.push("Roster belum diisi");
        }
        const entries = period.entries.map((entry) => {
            let sections: NonNullable<typeof snapshot>["sections"] = snapshot ? [] : [{
                id: "legacy", title: period.title, targetId: null,
                questions: ((period.questions as QprQuestion[] | null) ?? []).map((q, i) => ({
                    id: `legacy-${i}`, type: "scale", label: q.label, category: q.category, required: true,
                })),
            }];
            if (snapshot) {
                try { sections = resolveSnapshotPath(snapshot, entry); }
                catch (error) { blockers.push(`${entry.name}: ${(error as Error).message}`); }
                if (snapshot.version === 3 && !canonical.some((d) => d.slug === entry.divisionSlug)) blockers.push(`${entry.name}: divisi perlu pemetaan BPH`);
                if (snapshot.version === 3 && !entry.memberKey) blockers.push(`${entry.name}: member_key wajib`);
            }
            return { id: entry.id, name: entry.name, display_name: displayName(entry), division_slug: entry.divisionSlug,
                role: entry.memberRole, member_key: entry.memberKey, targets: sections.map((s) => s.targetId), sections,
                required: snapshot ? sections.flatMap((s) => s.questions).filter((q) => q.required).length : (period.questions as QprQuestion[]).length };
        });
        return { blockers: [...new Set(blockers)], entries, divisions: canonical, scale_legend: SCALE_LEGEND };
    },

    async participation(db: Db, divisionSlug: string, periodId?: string) {
        const rows = await db.select({
            period: { id: qprPeriods.id, title: qprPeriods.title, description: qprPeriods.description, status: qprPeriods.status,
                opensAt: qprPeriods.opensAt, closesAt: qprPeriods.closesAt, formKind: qprPeriods.formKind },
            name: qprEntries.name, division: qprEntries.division, role: qprEntries.memberRole, done: qprEntries.done,
        }).from(qprPeriods).innerJoin(qprEntries, eq(qprEntries.periodId, qprPeriods.id))
          .where(and(eq(qprEntries.divisionSlug, divisionSlug),
            sql`(${qprPeriods.firstOpenedAt} IS NOT NULL OR ${qprPeriods.status} IN ('open', 'closed'))`,
            periodId ? eq(qprPeriods.id, periodId) : undefined)).orderBy(asc(qprPeriods.title), asc(qprEntries.name));
        const groups = new Map<string, { period: typeof rows[number]["period"]; entries: Array<{name:string; display_name:string; role:string|null; done:boolean; status:string}> }>();
        for (const row of rows) {
            const group = groups.get(row.period.id) ?? { period: row.period, entries: [] };
            group.entries.push({ name: row.name, display_name: displayName({ name: row.name, division: row.division, memberRole: row.role }),
                role: row.role, done: row.done, status: row.done ? "Sudah mengisi" : "Belum mengisi" });
            groups.set(row.period.id, group);
        }
        const results = [...groups.values()].map((g) => ({ period: g.period, total_entries: g.entries.length,
            done_entries: g.entries.filter((e) => e.done).length, pending_entries: g.entries.filter((e) => !e.done).length,
            ...(periodId ? { entries: g.entries } : {}) }));
        if (periodId) {
            if (!results.length) throw ApiError.notFound("Periode QPR tidak ditemukan untuk divisi ini");
            return results[0];
        }
        return results.map(({ period, ...counts }) => ({ ...period, ...counts }));
    },
	async listPeriods(db: Db) {
		const periods = await db.select().from(qprPeriods).orderBy(asc(qprPeriods.title));
		if (!periods.length) return [];
		const counts = await db
			.select({ periodId: qprEntries.periodId, done: qprEntries.done })
			.from(qprEntries)
			.where(sql`${qprEntries.periodId} IN (SELECT value FROM json_each(${JSON.stringify(periods.map((p) => p.id))}))`);
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
		return { ...period, questions: parseFieldOptions(period.questions), entries: entries.map((e) => ({ ...e, mapping_required: !e.divisionSlug })) };
	},

	async createPeriod(db: Db, input: { title: string; description?: string | null; questions?: QprQuestion[] | null; form_kind?: "legacy" | "bph" | "division" | null; opens_at?: string | null; closes_at?: string | null; target_config?: TargetConfig; userId: string }) {
		const validated = createPeriodSchema.safeParse(input);
		if (!validated.success) throw ApiError.validation("Periode tidak valid", { input: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
		validateSchedule(input.opens_at, input.closes_at);
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
			const errorsConfig = input.target_config ? validateTargetConfig(input.target_config) : [];
			if (errorsConfig.length) throw ApiError.validation("Konfigurasi target tidak valid", { target_config: errorsConfig });
			questionsJson = JSON.stringify(buildBphSnapshot(input.target_config));
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
		return { ...period, questions: parseFieldOptions(period.questions) };
	},

	async updatePeriod(db: Db, id: string, input: UpdatePeriodInput) {
		const validated = updatePeriodSchema.safeParse(input);
		if (!validated.success) throw ApiError.validation("Perubahan periode tidak valid", { input: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
		input = validated.data;
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, id)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
        const changingSnapshot = input.questions !== undefined || input.target_config !== undefined || input.question_labels !== undefined || input.sections !== undefined || (input.form_kind != null && input.form_kind !== period.formKind);
        if (input.questions !== undefined && !input.questions?.length) throw ApiError.validation("Pertanyaan wajib diisi");
        if (changingSnapshot && period.firstOpenedAt) throw ApiError.conflict("Periode pernah dibuka — snapshot terkunci");
        if (input.form_kind != null && input.form_kind !== period.formKind) throw ApiError.validation("Jenis periode tidak bisa diubah");
        if (period.formKind === "bph" && input.questions !== undefined) throw ApiError.validation("Pertanyaan BPH berasal dari template");
        let questionsJson: string | undefined;
        if (input.target_config !== undefined || input.question_labels !== undefined || input.sections !== undefined) {
            const current = parseV2(period);
            if (current?.version !== 3) throw ApiError.validation("Kustomisasi hanya untuk snapshot v3");
            if (input.expected_snapshot && snapshotKey(input.expected_snapshot) !== snapshotKey(current))
                throw ApiError.conflict("Snapshot berubah — muat ulang sebelum menyimpan");
            const configErrors = input.target_config ? validateTargetConfig(input.target_config) : [];
            if (configErrors.length) throw ApiError.validation("Konfigurasi target tidak valid", { target_config: configErrors });
            const base = input.target_config ? buildBphSnapshot(input.target_config, current) : current;
            if (input.sections) base.sections = input.sections;
            if (input.question_labels) {
                const unknown = Object.keys(input.question_labels).filter((qid) => !base.sections.some((s) => s.questions.some((q) => q.id === qid)));
                if (unknown.length) throw ApiError.validation("ID pertanyaan tidak dikenal", { question_labels: unknown });
                base.sections = base.sections.map((s) => ({ ...s, questions: s.questions.map((q) => input.question_labels![q.id] ? { ...q, label: input.question_labels![q.id] } : q) }));
            }
            // Target identity belongs to config; sections edit wording/order/questions, never routing.
            base.sections = base.sections.map((s) => ({ ...s, targetLabel: base.target_config.targets.find((t) => t.id === s.targetId)?.label ?? s.targetLabel }));
            const snapshotErrors = validateSnapshotMutation(base);
            if (snapshotErrors.length) throw ApiError.validation("Snapshot tidak valid", { sections: snapshotErrors });
            questionsJson = JSON.stringify(base);
        }
        validateSchedule(input.opens_at === undefined ? period.opensAt : input.opens_at, input.closes_at === undefined ? period.closesAt : input.closes_at);
		const now = new Date().toISOString();
		const [updated] = await db
			.update(qprPeriods)
			.set({
				...(input.title !== undefined ? { title: input.title } : {}),
				...(input.description !== undefined ? { description: input.description } : {}),
				...(input.questions !== undefined ? { questions: JSON.stringify(input.questions) } : {}),
				...(questionsJson !== undefined ? { questions: questionsJson } : {}),
				...(input.opens_at !== undefined ? { opensAt: input.opens_at } : {}),
				...(input.closes_at !== undefined ? { closesAt: input.closes_at } : {}),
				updatedAt: now,
			})
			.where(and(eq(qprPeriods.id, id), changingSnapshot ? sql`${qprPeriods.firstOpenedAt} IS NULL` : undefined, changingSnapshot ? eq(qprPeriods.questions, period.questions) : undefined))
			.returning();
		if (!updated) throw ApiError.conflict("Snapshot berubah atau periode pernah dibuka — muat ulang sebelum menyimpan");
		return { ...updated, questions: parseFieldOptions(updated.questions) };
	},

	async setStatus(db: Db, id: string, status: "draft" | "open" | "closed") {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, id)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
        const preview = status === "open" ? await this.preview(db, id) : null;
        if (preview?.blockers.length) throw ApiError.validation("Konfigurasi belum lengkap", { blockers: preview.blockers });
        const now = new Date().toISOString();
        // ponytail: one JSON roster comparison avoids D1's bind limit; indexed relational revision if roster scale grows.
        const rosterGuard = preview ? sql`(SELECT count(*) FROM qpr_entries WHERE period_id = ${id}) = ${preview.entries.length}
            AND NOT EXISTS (SELECT 1 FROM json_each(${JSON.stringify(preview.entries.map((e) => ({ id:e.id,name:e.name,role:e.role,division_slug:e.division_slug,member_key:e.member_key })))}) j
            WHERE NOT EXISTS (SELECT 1 FROM qpr_entries e WHERE e.period_id = ${id}
                AND e.id = json_extract(j.value, '$.id') AND e.name = json_extract(j.value, '$.name')
                AND e.member_role IS json_extract(j.value, '$.role') AND e.division_slug IS json_extract(j.value, '$.division_slug')
                AND e.member_key IS json_extract(j.value, '$.member_key')))` : undefined;
        const [updated] = await db.update(qprPeriods).set({ status, updatedAt: now,
            ...(status === "open" ? { firstOpenedAt: sql`coalesce(${qprPeriods.firstOpenedAt}, ${now})` } : {}) })
            .where(and(eq(qprPeriods.id, id), preview ? eq(qprPeriods.questions, period.questions) : undefined, rosterGuard)).returning();
        if (!updated) throw ApiError.conflict("Konfigurasi berubah saat membuka — preview ulang");
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
		if (period.firstOpenedAt) throw ApiError.conflict("Periode pernah dibuka — tidak bisa dihapus");
		if (answered.length) throw ApiError.conflict("Periode masih punya penilaian tersimpan — rekap dulu sebelum menghapus");
		const deleted = await db.delete(qprPeriods).where(and(eq(qprPeriods.id, id), sql`${qprPeriods.firstOpenedAt} IS NULL`, sql`NOT EXISTS (SELECT 1 FROM qpr_answers a JOIN qpr_entries e ON e.id=a.entry_id WHERE e.period_id=${id})`)).returning();
        if (!deleted.length) throw ApiError.conflict("Periode pernah dibuka atau memiliki jawaban — tidak bisa dihapus");
		return period;
	},

	async addEntries(db: Db, periodId: string, items: Array<{ name: string; division?: string | null; role?: string | null; division_slug?: string | null; member_key?: string | null }>) {
        const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
        if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
        if (period.firstOpenedAt) throw ApiError.conflict("Periode pernah dibuka — roster terkunci");
        const snapshot = parseV2(period);
        const existing = await db.select().from(qprEntries).where(eq(qprEntries.periodId, periodId));
        const canonical = await db.select({ slug: divisions.slug, name: divisions.name }).from(divisions).where(inArray(divisions.slug, [...QPR_DIVISIONS]));
        const keys = new Set<string>();
        const names = new Set(existing.map((e) => e.name.toLowerCase()));
        const now = new Date().toISOString();
        const rows = items.map((a) => {
            const name = a.name.trim();
            if (!name) throw ApiError.validation("Nama wajib diisi");
            const key = a.member_key;
            if (key != null && !key.trim()) throw ApiError.validation("member_key tidak boleh kosong");
            const division = canonical.find((d) => d.slug === a.division_slug);
            if (a.division_slug != null && !division) throw ApiError.validation("Divisi tidak dikenal");
            if (a.role != null && !(QPR_ROLES as readonly string[]).includes(a.role)) throw ApiError.validation("Jabatan pengisi tidak dikenal");
            if (snapshot?.version === 3 && (!key || !division || !a.role)) throw ApiError.validation("member_key, division_slug, dan role wajib untuk roster v3");
            if (key && keys.has(key)) throw ApiError.validation("member_key berulang dalam impor");
            if (key) keys.add(key);
            if ((!snapshot || !key) && names.has(name.toLowerCase())) throw ApiError.conflict(`Nama "${name}" sudah ada di daftar periode ini`);
            names.add(name.toLowerCase());
            const old = key ? existing.find((e) => e.memberKey === key) : undefined;
            return { id: old?.id ?? uuidv7(), periodId, name, division: division?.name ?? a.division ?? null,
                memberRole: a.role ?? null, divisionSlug: division?.slug ?? null, memberKey: key ?? uuidv7(), done: false, createdAt: old?.createdAt ?? now };
        });
        try {
            if (!rows.length) throw ApiError.validation("Roster wajib diisi");
            await db.batch(rows.map((row) => db.insert(qprEntries).values(row).onConflictDoUpdate({
                target: [qprEntries.periodId, qprEntries.memberKey],
                set: { name: row.name, division: row.division, memberRole: row.memberRole, divisionSlug: row.divisionSlug },
            })) as unknown as Parameters<Db["batch"]>[0]);
        } catch (error) {
            if (String(error).includes("QPR legacy name duplicate")) throw ApiError.conflict("Nama sudah ada di daftar periode ini");
            if (String(error).includes("QPR roster frozen")) throw ApiError.conflict("Periode pernah dibuka — roster terkunci");
            throw error;
        }
        return rows;
	},

	async deleteEntry(db: Db, periodId: string, entryId: string) {
        const [p] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId));
        if (p?.firstOpenedAt) throw ApiError.conflict("Periode pernah dibuka — roster terkunci");
		const [row] = await db
			.select()
			.from(qprEntries)
			.where(and(eq(qprEntries.id, entryId), eq(qprEntries.periodId, periodId)))
			.limit(1);
		if (!row) throw ApiError.notFound("Nama tidak ditemukan");
		// Entry final menyimpan jawaban penilaian — cascade hapus jawaban lewat
		// penghapusan nama tidak boleh lewat jalur biasa.
		if (row.done) throw ApiError.conflict("Nama ini sudah mengisi penilaian — jawaban tidak boleh dihapus lewat sini");
		const removed = await db.delete(qprEntries).where(and(eq(qprEntries.id, entryId), sql`EXISTS (SELECT 1 FROM qpr_periods WHERE id = ${periodId} AND first_opened_at IS NULL)`)).returning();
        if (!removed.length) throw ApiError.conflict("Periode pernah dibuka — roster terkunci");
		return row;
	},

	/** Daftar publik untuk dropdown: hanya periode terbuka + nama yang BELUM done. */
	async publicRoster(db: Db, periodId: string) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period || !periodIsOpen(period)) throw ApiError.notFound("Periode penilaian tidak ditemukan atau sudah ditutup");
		const entries = await db
			.select({ id: qprEntries.id, name: qprEntries.name, division: qprEntries.division, role: qprEntries.memberRole, division_slug: qprEntries.divisionSlug })
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
			remaining: entries.map((e) => ({ ...e, display_name: displayName({ ...e, memberRole: e.role }) })),
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
		const parsedQuestions = parseQuestions(period.questions);
        if (!Array.isArray(parsedQuestions)) throw ApiError.validation("Gunakan submit-v2 untuk snapshot");
        const questions = parsedQuestions;
		const valid = new Set(questions.map((q) => JSON.stringify([q.label, q.category])));
		if (input.answers.some((a) => !valid.has(JSON.stringify([a.label, a.category])))) {
			throw ApiError.validation("Jawaban tidak sesuai pertanyaan periode ini", {
				answers: ["Label/kategori jawaban tidak dikenal."],
			});
		}
        const answered = input.answers.map((a) => JSON.stringify([a.label, a.category]));
        const expected = questions.map((q) => JSON.stringify([q.label, q.category]));
        if (answered.length !== expected.length || new Set(answered).size !== answered.length || expected.some((id) => !answered.includes(id))) {
            throw ApiError.validation("Jawaban wajib belum lengkap atau berulang");
        }
        const stored = input.note ? [...input.answers, { label: "Catatan", category: "Catatan", score: 5, note: input.note }] : input.answers;
        return insertFinal(db, periodId, entry, stored, null);
	},

	// ── Draft v2: server-side autosave, lanjut lintas perangkat cukup pilih nama ──

	/** GET draft: pertanyaan jalur + draft tersimpan + progres. Tanpa login (model kejuhuran). */
	async getDraft(db: Db, periodId: string, entryId: string) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period || !periodIsOpen(period)) throw ApiError.notFound("Periode penilaian tidak ditemukan atau sudah ditutup");
		const [entry] = await db.select().from(qprEntries).where(and(eq(qprEntries.id, entryId), eq(qprEntries.periodId, periodId))).limit(1);
		if (!entry) throw ApiError.notFound("Nama tidak ditemukan di periode ini");
		if (entry.done) throw finalConflict();
		const v2 = parseV2(period);
		if (!v2) throw ApiError.validation("Periode ini memakai format lama — draft tidak tersedia");
		// Jalur responden dari snapshot identitas roster; entry legacy tanpa
		// member_role diperlakukan anggota biasa (ketum+waketum).
		const sections = pathFor(v2, entry);
		const questions = sections.flatMap((s) => s.questions);
		const draft = entry.draftAnswers ? (parseFieldOptions(entry.draftAnswers) as DraftAnswer[]) : [];
		const requiredIds = new Set(questions.filter((q) => q.required).map((q) => q.id));
		const filled = draft.filter((a) => {
			const q = questions.find((x) => x.id === a.question_id);
			if (!q) return false;
			return q.type === "scale" ? typeof a.value === "number" : typeof a.value === "string" && a.value.trim().length > 0;
		});
		const nextUnanswered = questions.find((q) => q.required && !filled.some((f) => f.question_id === q.id));
		return {
			entry: { id: entry.id, name: entry.name, division: entry.division, role: entry.memberRole, division_slug: entry.divisionSlug, display_name: displayName(entry) },
			sections,
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
		if (entry.done) throw finalConflict();
		const v2 = parseV2(period);
		if (!v2) throw ApiError.validation("Periode ini memakai format lama — draft tidak tersedia");
		const sections = pathFor(v2, entry);
		const questions = sections.flatMap((s) => s.questions);
		validateDraftAnswers(questions, input.answers);
		const now = new Date().toISOString();
		const updated = await db
			.update(qprEntries)
			.set({ draftAnswers: JSON.stringify(input.answers), draftVersion: sql`${qprEntries.draftVersion} + 1`, draftUpdatedAt: now })
			.where(and(eq(qprEntries.id, entryId), eq(qprEntries.done, false), eq(qprEntries.draftVersion, input.expected_version), eq(qprEntries.periodId, periodId), openSql))
			.returning({ id: qprEntries.id, draftVersion: qprEntries.draftVersion });
		if (!updated.length) return writeConflict(db, periodId, entryId);
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
		if (entry.done) throw finalConflict();
		const v2 = parseV2(period);
		if (!v2) throw ApiError.validation("Periode ini memakai format lama — gunakan submit lama");
        if (v2.version === 3 && input.expected_version == null) throw ApiError.validation("expected_version wajib untuk snapshot v3");
		const sections = pathFor(v2, entry);
		const questions = sections.flatMap((s) => s.questions);
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

        return insertFinal(db, periodId, entry, input.answers, input.expected_version ?? entry.draftVersion);
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
					.where(sql`${qprAnswers.entryId} IN (SELECT value FROM json_each(${JSON.stringify(doneEntries.map((e) => e.id))}))`)
			: [];
		// Skor terkumpul per question_id — hanya dari jalur responden yang
		// menilai target itu (denominator = jumlah jawaban final pertanyaan itu).
		const scores = new Map<string, number[]>();
		const texts = new Map<string, string[]>();
        const textResponses = new Map<string, Array<{ name:string; division:string|null; role:string|null; text:string }>>();
		for (const row of answerRows) {
			const parsed = JSON.parse(row.answers) as Array<{ question_id: string; value: number | string }>;
            const entry = doneEntries.find((e) => e.id === row.entryId)!;
            const valid = new Map(pathFor(v2, entry).flatMap((s) => s.questions).map((q) => [q.id, q]));
            const seen = new Set<string>();
			for (const a of parsed) {
                const question = valid.get(a.question_id);
                if (!question || seen.has(a.question_id)) continue;
                seen.add(a.question_id);
				if (question.type === "scale" && typeof a.value === "number" && Number.isInteger(a.value) && a.value >= 1 && a.value <= 5) {
					const list = scores.get(a.question_id) ?? [];
					list.push(a.value);
					scores.set(a.question_id, list);
				} else if (question.type === "text" && typeof a.value === "string" && a.value.trim()) {
					const list = texts.get(a.question_id) ?? [];
					list.push(a.value.trim());
					texts.set(a.question_id, list);
                    const identified = textResponses.get(a.question_id) ?? [];
                    identified.push({name:entry.name,division:entry.division,role:entry.memberRole,text:a.value.trim()});
                    textResponses.set(a.question_id, identified);
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
					return { id: q.id, type: q.type, label: q.label, required: q.required, responses: list.length, texts: list, text_responses: textResponses.get(q.id) ?? [] };
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
            respondents: doneEntries.map((e) => ({ id: e.id, name: e.name, division: e.division, division_slug: e.divisionSlug, role: e.memberRole })),
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
					.where(sql`${qprAnswers.entryId} IN (SELECT value FROM json_each(${JSON.stringify(entries.map((e) => e.id))}))`)
			: [];
		const byEntry = new Map(answerRows.map((r) => [r.entryId, r]));
		// Header = superset kolom semua jalur; kolom tak berlaku untuk responden kosong.
		const header = v2.sections.flatMap((s) => s.questions.map((q) => [s.targetLabel || s.title, q.id, q.label] as const));
		const escape = (v: unknown) => {
			// Formula injection: awalan = + - @ tab/CR di-prefix ' agar Excel
			// memperlakukan sebagai teks, bukan formula.
			const s = String(v ?? "");
			const safe = /^[\s\u0000-\u001f]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(s) ? `'${s}` : s;
			return `"${safe.replace(/"/g, '""')}"`;
		};
		const lines = [
			["waktu_kirim", "nama", "divisi", "jabatan", ...header.map(([target, qid, label]) => `${target} | ${qid} | ${label}`)].map(escape).join(","),
			...entries.map((e) => {
				const row = byEntry.get(e.id);
				const answers = row ? (JSON.parse(row.answers) as Array<{ question_id: string; value: number | string }>) : [];
				const applicable = new Set(pathFor(v2, e).flatMap((s) => s.questions).map((q) => q.id));
                const byId = new Map(answers.filter((a) => applicable.has(a.question_id)).map((a) => [a.question_id, a.value]));
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
					.where(sql`${qprAnswers.entryId} IN (SELECT value FROM json_each(${JSON.stringify(entries.map((e) => e.id))}))`)
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
