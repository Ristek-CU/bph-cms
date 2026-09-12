import { and, asc, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { ApiError } from "../../shared/api-error";
import { qprAnswers, qprEntries, qprPeriods } from "../../db/schema";
import { parseFieldOptions } from "../forms/form.service";
import type { Db } from "../../db/connection";
import type { QprQuestion, SubmitAnswersInput } from "./qpr.schema";

const periodIsOpen = (p: { status: string; opensAt: string | null; closesAt: string | null }) => {
	if (p.status !== "open") return false;
	const now = new Date().toISOString();
	if (p.opensAt && p.opensAt > now) return false;
	if (p.closesAt && p.closesAt < now) return false;
	return true;
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

	async createPeriod(db: Db, input: { title: string; description?: string | null; questions: QprQuestion[]; opens_at?: string | null; closes_at?: string | null; userId: string }) {
		const now = new Date().toISOString();
		const [existing] = await db.select({ id: qprPeriods.id }).from(qprPeriods).where(eq(qprPeriods.title, input.title)).limit(1);
		if (existing) throw ApiError.conflict("Periode dengan judul ini sudah ada");
		const [period] = await db
			.insert(qprPeriods)
			.values({
				id: uuidv7(),
				title: input.title,
				description: input.description ?? null,
				questions: JSON.stringify(input.questions),
				status: "draft",
				opensAt: input.opens_at ?? null,
				closesAt: input.closes_at ?? null,
				createdByUserId: input.userId,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return { ...period, questions: input.questions };
	},

	async updatePeriod(db: Db, id: string, input: Partial<{ title: string; description: string | null; questions: QprQuestion[]; opens_at: string | null; closes_at: string | null }>) {
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

	async addEntries(db: Db, periodId: string, items: Array<{ name: string; division?: string | null }>) {
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
		if (entry.done) throw ApiError.conflict("Nama ini sudah mengisi penilaian.");
		const now = new Date().toISOString();
		await db.insert(qprAnswers).values({ id: uuidv7(), entryId: entry.id, answers: JSON.stringify(input.answers), submittedAt: now });
		await db.update(qprEntries).set({ done: true, submittedAt: now }).where(eq(qprEntries.id, entry.id));
		return { entry_id: entry.id, name: entry.name };
	},

	/** Rekap: rata-rata skor per kategori + partisipasi (siapa sudah/belum). */
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
			const parsed = (parseFieldOptions(byEntry.get(e.id) ?? null) as Array<{ category?: string; score?: number; note?: string }>) ?? [];
			for (const a of parsed) {
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
