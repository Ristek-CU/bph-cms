import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import type { AppContext } from "../../types";
import { adminAuth } from "../../middlewares/admin-auth";
import { requirePermission } from "../../middlewares/require-permission";
import { ApiResponse } from "../../shared/api-response";
import { recordAuditLog } from "../audit/audit.service";
import { parseJson, parseParams } from "../../shared/parse-request";
import { idParamSchema } from "../forms/form.schema";
import { getDb } from "../../db/connection";
import { qprService } from "./qpr.service";
import { createAssignmentsSchema, createPeriodSchema, submitAnswersSchema, updatePeriodSchema } from "./qpr.schema";
import { successWrapper, errorWrapper } from "../openapi/schemas";

const describe = (
	summary: string,
	description: string,
	responseSchema: z.ZodTypeAny,
	extra: Record<number, { description: string }> = {},
) =>
	describeRoute({
		summary,
		description,
		tags: ["Admin QPR"],
		security: [{ bearerAuth: [] }],
		responses: {
			200: { description: "Success", content: { "application/json": { schema: resolver(responseSchema) } } },
			401: { description: "Unauthorized", content: { "application/json": { schema: resolver(errorWrapper) } } },
			403: { description: "Forbidden (khusus qpr.manage)" },
			...extra,
		},
	});

/**
 * QPR v1 (docs/QPR-PRD.md §5): khusus BPH (qpr.manage).
 * Endpoint admin: kelola periode + penugasan + rekap.
 * Endpoint pengisi: /my (penugasan user login) dan submit penilaian.
 */
export const adminQprRouter = new Hono<AppContext>();

adminQprRouter.use("*", adminAuth);

// --- Endpoint pengisi (bukan khusus BPH — sesuai PRD §2: ketua/anggota ikut menilai) ---

adminQprRouter.get(
	"/my",
	describe("Penugasan QPR saya", "Daftar orang yang harus dinilai user login, plus pertanyaan periodenya.", successWrapper(z.object({}))),
	async (c) => {
		return ApiResponse.ok(c, "OK", await qprService.myAssignments(getDb(c.env.DB), c.get("userId") ?? ""));
	},
);

adminQprRouter.post(
	"/assignments/:id/submit",
	describe(
		"Kirim/revisi penilaian",
		"Body: { answers: [{ label, category, score 1-5, note? }] }. Boleh revisi selama periode terbuka.",
		successWrapper(z.object({})),
		{ 403: { description: "Bukan penugasan kamu" }, 409: { description: "Periode tidak terbuka" }, 422: { description: "Validation error" } },
	),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		const input = await parseJson(c, submitAnswersSchema);
		const result = await qprService.submitAnswers(getDb(c.env.DB), id, c.get("userId") ?? "", input);
		await recordAuditLog(c, { action: "qpr.submit", resourceType: "qpr_assignment", resourceId: id });
		return ApiResponse.ok(c, "Penilaian tersimpan", result);
	},
);

// --- Endpoint admin (qpr.manage, khusus BPH) ---

adminQprRouter.get(
	"/periods",
	requirePermission("qpr.manage"),
	describe("List periode QPR", "Termasuk hitungan penugasan selesai/total.", successWrapper(z.array(z.object({})))),
	async (c) => ApiResponse.ok(c, "OK", await qprService.listPeriods(getDb(c.env.DB))),
);

adminQprRouter.post(
	"/periods",
	requirePermission("qpr.manage"),
	describe("Buat periode QPR", "Status awal draft. Questions: [{ label, category }].", successWrapper(z.object({})), { 409: { description: "Judul sudah dipakai" } }),
	async (c) => {
		const input = await parseJson(c, createPeriodSchema);
		const result = await qprService.createPeriod(getDb(c.env.DB), { ...input, userId: c.get("userId") ?? "" });
		await recordAuditLog(c, { action: "qpr.period_create", resourceType: "qpr_period", resourceId: result.id, metadata: { title: result.title } });
		return ApiResponse.created(c, "Periode QPR dibuat", result);
	},
);

adminQprRouter.get(
	"/periods/:id",
	requirePermission("qpr.manage"),
	describe("Detail periode", "Periode + semua penugasan.", successWrapper(z.object({})), { 404: { description: "Not found" } }),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		return ApiResponse.ok(c, "OK", await qprService.getPeriod(getDb(c.env.DB), id));
	},
);

adminQprRouter.put(
	"/periods/:id",
	requirePermission("qpr.manage"),
	describe("Update periode (parsial)", "Periode closed menolak perubahan judul/pertanyaan.", successWrapper(z.object({})), { 404: { description: "Not found" } }),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		const input = await parseJson(c, updatePeriodSchema);
		const result = await qprService.updatePeriod(getDb(c.env.DB), id, input);
		await recordAuditLog(c, { action: "qpr.period_update", resourceType: "qpr_period", resourceId: id });
		return ApiResponse.ok(c, "Periode diperbarui", result);
	},
);

adminQprRouter.post(
	"/periods/:id/open",
	requirePermission("qpr.manage"),
	describe("Buka periode", "Pengisi mulai bisa mengirim penilaian.", successWrapper(z.object({}))),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		return ApiResponse.ok(c, "Periode dibuka", await qprService.setStatus(getDb(c.env.DB), id, "open"));
	},
);

adminQprRouter.post(
	"/periods/:id/close",
	requirePermission("qpr.manage"),
	describe("Tutup periode", "Menolak pengiriman/revision baru.", successWrapper(z.object({}))),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		return ApiResponse.ok(c, "Periode ditutup", await qprService.setStatus(getDb(c.env.DB), id, "closed"));
	},
);

adminQprRouter.delete(
	"/periods/:id",
	requirePermission("qpr.manage"),
	describe("Hapus periode", "Ditolak 409 bila sudah ada penilaian tersimpan.", successWrapper(z.object({})), { 409: { description: "Masih ada penilaian" } }),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		const deleted = await qprService.deletePeriod(getDb(c.env.DB), id);
		await recordAuditLog(c, { action: "qpr.period_delete", resourceType: "qpr_period", resourceId: id, metadata: { title: deleted.title } });
		return ApiResponse.ok(c, "Periode dihapus");
	},
);

adminQprRouter.post(
	"/periods/:id/assignments",
	requirePermission("qpr.manage"),
	describe("Tambah penugasan", "Body: { assignments: [{ reviewer_user_id, reviewer_email, reviewee_name, reviewee_role? }] }.", successWrapper(z.array(z.object({}))), {
		404: { description: "Periode tidak ditemukan" },
	}),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		const input = await parseJson(c, createAssignmentsSchema);
		const rows = await qprService.addAssignments(
			getDb(c.env.DB),
			id,
			input.assignments.map((a) => ({
				reviewer_user_id: a.reviewer_user_id,
				reviewer_email: a.reviewer_email,
				reviewee_name: a.reviewee_name,
				reviewee_role: a.reviewee_role,
			})),
		);
		await recordAuditLog(c, { action: "qpr.assignments_add", resourceType: "qpr_period", resourceId: id, metadata: { count: rows.length } });
		return ApiResponse.created(c, "Penugasan ditambahkan", rows);
	},
);

adminQprRouter.delete(
	"/periods/:id/assignments/:assignmentId",
	requirePermission("qpr.manage"),
	describe("Hapus penugasan", "Jawaban penugasan ikut terhapus.", successWrapper(z.object({})), { 404: { description: "Not found" } }),
	async (c) => {
		const { id, assignmentId } = c.req.param();
		await qprService.deleteAssignment(getDb(c.env.DB), id, assignmentId);
		await recordAuditLog(c, { action: "qpr.assignment_delete", resourceType: "qpr_assignment", resourceId: assignmentId });
		return ApiResponse.ok(c, "Penugasan dihapus");
	},
);

adminQprRouter.get(
	"/periods/:id/recap",
	requirePermission("qpr.manage"),
	describe("Rekap periode", "Rata-rata skor per orang per kategori + catatan (PRD §5: rata-rata sederhana).", successWrapper(z.object({})), {
		404: { description: "Not found" },
	}),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		return ApiResponse.ok(c, "OK", await qprService.recap(getDb(c.env.DB), id));
	},
);
