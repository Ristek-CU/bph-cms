import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import type { AppContext } from "../../types";
import { adminAuth } from "../../middlewares/admin-auth";
import { requirePermission } from "../../middlewares/require-permission";
import { ApiResponse } from "../../shared/api-response";
import { ApiError } from "../../shared/api-error";
import { recordAuditLog } from "../audit/audit.service";
import { parseJson, parseParams } from "../../shared/parse-request";
import { idParamSchema } from "../forms/form.schema";
import { getDb } from "../../db/connection";
import { publicRateLimiter, d1RateLimiter } from "../../middlewares/rate-limiter";
import { qprService } from "./qpr.service";
import { createEntriesSchema, createPeriodSchema, submitAnswersSchema, updatePeriodSchema } from "./qpr.schema";
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
 * QPR v2 — tanpa login (model kejujuran):
 * - BPH (qpr.manage): kelola periode + roster nama pengisi + rekap partisipasi.
 * - Publik: GET /qpr/:periodId (roster belum-isi + pertanyaan), POST submit
 *   by nama → nama terkunci done, hilang dari dropdown (tanda sudah isi).
 */
export const publicQprRouter = new Hono<AppContext>();

// --- Endpoint publik (tanpa login) ---

publicQprRouter.use("*", publicRateLimiter);

publicQprRouter.get(
	"/:periodId",
	describeRoute({
		summary: "Roster publik periode QPR",
		description: "Tanpa login. Hanya periode berstatus open. Mengembalikan pertanyaan + nama yang belum mengisi (untuk dropdown).",
		tags: ["Public QPR"],
		responses: {
			200: { description: "Success", content: { "application/json": { schema: resolver(successWrapper(z.object({}))) } } },
			404: { description: "Periode tidak ditemukan/tutup", content: { "application/json": { schema: resolver(errorWrapper) } } },
		},
	}),
	async (c) => {
		const { periodId } = c.req.param();
		return ApiResponse.ok(c, "OK", await qprService.publicRoster(getDb(c.env.DB), periodId));
	},
);

publicQprRouter.post(
	"/:periodId/submit",
	describeRoute({
		summary: "Kirim penilaian (publik)",
		description: "Body: { name, answers: [{ label, category, score 1-5, note? }] }. Nama harus terdaftar & belum mengisi. Sekali kirim, nama terkunci.",
		tags: ["Public QPR"],
		responses: {
			200: { description: "Success", content: { "application/json": { schema: resolver(successWrapper(z.object({}))) } } },
			404: { description: "Periode tidak ditemukan/tutup" },
			409: { description: "Nama sudah mengisi" },
			422: { description: "Nama tidak terdaftar / validasi gagal" },
		},
	}),
	d1RateLimiter({ prefix: "public:qpr", limit: 10, windowMs: 60_000 }),
	async (c) => {
		const { periodId } = c.req.param();
		const input = await parseJson(c, submitAnswersSchema);
		const result = await qprService.submitPublic(getDb(c.env.DB), periodId, input);
		await recordAuditLog(c, { action: "qpr.public_submit", resourceType: "qpr_entry", resourceId: result.entry_id });
		return ApiResponse.ok(c, "Penilaian terkirim. Terima kasih!", result);
	},
);

// --- Endpoint admin (qpr.manage, khusus BPH) ---

export const adminQprRouter = new Hono<AppContext>();

adminQprRouter.use("*", adminAuth);

adminQprRouter.get(
	"/periods",
	requirePermission("qpr.manage"),
	describe("List periode QPR", "Termasuk hitungan sudah/belum mengisi.", successWrapper(z.array(z.object({})))),
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
	describe("Detail periode", "Periode + roster nama (sudah/belum isi).", successWrapper(z.object({})), { 404: { description: "Not found" } }),
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
	describe("Buka periode", "Link publik mulai aktif.", successWrapper(z.object({}))),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		return ApiResponse.ok(c, "Periode dibuka", await qprService.setStatus(getDb(c.env.DB), id, "open"));
	},
);

adminQprRouter.post(
	"/periods/:id/close",
	requirePermission("qpr.manage"),
	describe("Tutup periode", "Link publik 404, submit ditolak.", successWrapper(z.object({}))),
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
	"/periods/:id/entries",
	requirePermission("qpr.manage"),
	describe("Tambah nama pengisi", "Body: { entries: [{ name, division? }] }.", successWrapper(z.array(z.object({}))), {
		404: { description: "Periode tidak ditemukan" },
	}),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		const input = await parseJson(c, createEntriesSchema);
		const rows = await qprService.addEntries(getDb(c.env.DB), id, input.entries);
		await recordAuditLog(c, { action: "qpr.entries_add", resourceType: "qpr_period", resourceId: id, metadata: { count: rows.length } });
		return ApiResponse.created(c, "Nama ditambahkan", rows);
	},
);

adminQprRouter.delete(
	"/periods/:id/entries/:entryId",
	requirePermission("qpr.manage"),
	describe("Hapus nama", "Jawaban nama itu ikut terhapus.", successWrapper(z.object({})), { 404: { description: "Not found" } }),
	async (c) => {
		const { id, entryId } = c.req.param();
		if (!id || !entryId) throw ApiError.badRequest("Invalid parameters");
		await qprService.deleteEntry(getDb(c.env.DB), id, entryId);
		await recordAuditLog(c, { action: "qpr.entry_delete", resourceType: "qpr_entry", resourceId: entryId });
		return ApiResponse.ok(c, "Nama dihapus");
	},
);

adminQprRouter.get(
	"/periods/:id/recap",
	requirePermission("qpr.manage"),
	describe("Rekap periode", "Partisipasi (sudah/belum isi, nama pending), rata-rata per kategori, catatan.", successWrapper(z.object({})), {
		404: { description: "Not found" },
	}),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		return ApiResponse.ok(c, "OK", await qprService.recap(getDb(c.env.DB), id));
	},
);
