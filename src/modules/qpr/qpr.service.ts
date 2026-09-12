import { and, asc, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { ApiError } from "../../shared/api-error";
import { qprAnswers, qprAssignments, qprPeriods } from "../../db/schema";
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
			.select({ periodId: qprAssignments.periodId, status: qprAssignments.status })
			.from(qprAssignments)
			.where(inArray(qprAssignments.periodId, periods.map((p) => p.id)));
		return periods.map((p) => {
			const rows = counts.filter((c) => c.periodId === p.id);
			return {
				...p,
				questions: parseFieldOptions(p.questions),
				total_assignments: rows.length,
				done_assignments: rows.filter((r) => r.status === "done").length,
			};
		});
	},

	async getPeriod(db: Db, id: string) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, id)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
		const assignments = await db
			.select()
			.from(qprAssignments)
			.where(eq(qprAssignments.periodId, id))
			.orderBy(asc(qprAssignments.reviewerEmail), asc(qprAssignments.revieweeName));
		return {
			...period,
			questions: parseFieldOptions(period.questions),
			assignments,
		};
	},

	async createPeriod(db: Db, input: { title: string; questions: QprQuestion[]; opens_at?: string | null; closes_at?: string | null; userId: string }) {
		const now = new Date().toISOString();
		const [existing] = await db.select({ id: qprPeriods.id }).from(qprPeriods).where(eq(qprPeriods.title, input.title)).limit(1);
		if (existing) throw ApiError.conflict("Periode dengan judul ini sudah ada");
		const [period] = await db
			.insert(qprPeriods)
			.values({
				id: uuidv7(),
				title: input.title,
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

	async updatePeriod(db: Db, id: string, input: Partial<{ title: string; questions: QprQuestion[]; opens_at: string | null; closes_at: string | null }>) {
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
			.innerJoin(qprAssignments, eq(qprAnswers.assignmentId, qprAssignments.id))
			.where(eq(qprAssignments.periodId, id))
			.limit(1);
		if (answered.length) throw ApiError.conflict("Periode masih punya penilaian tersimpan — hapus penilaian dulu bila benar-benar mau menghapus");
		await db.delete(qprPeriods).where(eq(qprPeriods.id, id));
		return period;
	},

	async addAssignments(db: Db, periodId: string, items: Array<{ reviewer_user_id: string; reviewer_email: string; reviewee_name: string; reviewee_role?: string | null }>) {
		const [period] = await db.select({ id: qprPeriods.id }).from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
		const now = new Date().toISOString();
		const rows = items.map((a) => ({
			id: uuidv7(),
			periodId,
			reviewerUserId: a.reviewer_user_id,
			reviewerEmail: a.reviewer_email,
			revieweeName: a.reviewee_name,
			revieweeRole: a.reviewee_role ?? null,
			status: "pending" as const,
			createdAt: now,
			updatedAt: now,
		}));
		// batch insert — atomik, sekali jalan.
		await db.insert(qprAssignments).values(rows);
		return rows;
	},

	async deleteAssignment(db: Db, periodId: string, assignmentId: string) {
		const [row] = await db
			.select()
			.from(qprAssignments)
			.where(and(eq(qprAssignments.id, assignmentId), eq(qprAssignments.periodId, periodId)))
			.limit(1);
		if (!row) throw ApiError.notFound("Penugasan tidak ditemukan");
		await db.delete(qprAnswers).where(eq(qprAnswers.assignmentId, assignmentId));
		await db.delete(qprAssignments).where(eq(qprAssignments.id, assignmentId));
		return row;
	},

	/** Penugasan milik reviewer (user login). */
	async myAssignments(db: Db, userId: string) {
		const rows = await db
			.select({
				id: qprAssignments.id,
				status: qprAssignments.status,
				revieweeName: qprAssignments.revieweeName,
				revieweeRole: qprAssignments.revieweeRole,
				periodId: qprPeriods.id,
				periodTitle: qprPeriods.title,
				periodStatus: qprPeriods.status,
				questions: qprPeriods.questions,
				opensAt: qprPeriods.opensAt,
				closesAt: qprPeriods.closesAt,
			})
			.from(qprAssignments)
			.innerJoin(qprPeriods, eq(qprAssignments.periodId, qprPeriods.id))
			.where(eq(qprAssignments.reviewerUserId, userId))
			.orderBy(asc(qprPeriods.title), asc(qprAssignments.revieweeName));
		return rows.map((r) => ({ ...r, questions: parseFieldOptions(r.questions) }));
	},

	/** Simpan/revisi penilaian — hanya saat periode terbuka. */
	async submitAnswers(db: Db, assignmentId: string, userId: string, input: SubmitAnswersInput) {
		const [row] = await db
			.select({ assignment: qprAssignments, period: qprPeriods })
			.from(qprAssignments)
			.innerJoin(qprPeriods, eq(qprAssignments.periodId, qprPeriods.id))
			.where(eq(qprAssignments.id, assignmentId))
			.limit(1);
		if (!row) throw ApiError.notFound("Penugasan tidak ditemukan");
		if (row.assignment.reviewerUserId !== userId) throw ApiError.forbidden("Ini bukan penugasan kamu");
		if (!periodIsOpen(row.period)) throw ApiError.conflict("Periode penilaian tidak sedang terbuka");
		const now = new Date().toISOString();
		const payload = JSON.stringify(input.answers);
		const [existing] = await db.select({ id: qprAnswers.id }).from(qprAnswers).where(eq(qprAnswers.assignmentId, assignmentId)).limit(1);
		if (existing) {
			await db.update(qprAnswers).set({ answers: payload, updatedAt: now }).where(eq(qprAnswers.id, existing.id));
		} else {
			await db.insert(qprAnswers).values({ id: uuidv7(), assignmentId, answers: payload, submittedAt: now, updatedAt: now });
		}
		if (row.assignment.status !== "done") {
			await db.update(qprAssignments).set({ status: "done", updatedAt: now }).where(eq(qprAssignments.id, assignmentId));
		}
		return { assignment_id: assignmentId, revised: Boolean(existing) };
	},

	/** Rekap: rata-rata skor per reviewee per kategori (PRD §5 — rata-rata sederhana). */
	async recap(db: Db, periodId: string) {
		const [period] = await db.select().from(qprPeriods).where(eq(qprPeriods.id, periodId)).limit(1);
		if (!period) throw ApiError.notFound("Periode QPR tidak ditemukan");
		const rows = await db
			.select({ revieweeName: qprAssignments.revieweeName, revieweeRole: qprAssignments.revieweeRole, answers: qprAnswers.answers })
			.from(qprAnswers)
			.innerJoin(qprAssignments, eq(qprAnswers.assignmentId, qprAssignments.id))
			.where(eq(qprAssignments.periodId, periodId));
		const byReviewee = new Map<string, { reviewee_name: string; reviewee_role: string | null; scores: Array<{ category: string; score: number }>; notes: string[] }>();
		for (const r of rows) {
			let entry = byReviewee.get(r.revieweeName);
			if (!entry) {
				entry = { reviewee_name: r.revieweeName, reviewee_role: r.revieweeRole, scores: [], notes: [] };
				byReviewee.set(r.revieweeName, entry);
			}
			const parsed = (parseFieldOptions(r.answers) as Array<{ category?: string; score?: number; note?: string }>) ?? [];
			for (const a of parsed) {
				if (typeof a.score === "number" && typeof a.category === "string") entry.scores.push({ category: a.category, score: a.score });
				if (a.note) entry.notes.push(a.note);
			}
		}
		return {
			period: { id: period.id, title: period.title, status: period.status },
			total_responses: rows.length,
			reviewees: Array.from(byReviewee.values()).map((e) => {
				const byCategory = new Map<string, number[]>();
				for (const s of e.scores) {
					const list = byCategory.get(s.category) ?? [];
					list.push(s.score);
					byCategory.set(s.category, list);
				}
				const categories: Record<string, number> = {};
				for (const [cat, list] of byCategory) {
					categories[cat] = Math.round((list.reduce((x, y) => x + y, 0) / list.length) * 100) / 100;
				}
				const all = e.scores.map((s) => s.score);
				return {
					reviewee_name: e.reviewee_name,
					reviewee_role: e.reviewee_role,
					categories,
					average: all.length ? Math.round((all.reduce((x, y) => x + y, 0) / all.length) * 100) / 100 : null,
					total_responses: all.length ? new Set(rows.map((r) => r.revieweeName === e.reviewee_name)).size : 0,
					notes: e.notes,
				};
			}),
		};
	},
};
