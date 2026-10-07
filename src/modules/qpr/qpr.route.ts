import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import type { AppContext } from "../../types";
import type { MiddlewareHandler } from "hono";
import { adminAuth } from "../../middlewares/admin-auth";
import { ApiResponse } from "../../shared/api-response";
import { ApiError } from "../../shared/api-error";
import { recordAuditLog } from "../audit/audit.service";
import { parseJson, parseParams } from "../../shared/parse-request";
import { idParamSchema } from "../forms/form.schema";
import { getDb } from "../../db/connection";
import { publicRateLimiter, d1RateLimiter } from "../../middlewares/rate-limiter";
import { qprService } from "./qpr.service";
import { createEntriesSchema, createPeriodSchema, saveDraftSchema, submitAnswersSchema, submitV2Schema, updatePeriodSchema } from "./qpr.schema";
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

publicQprRouter.use("*", async (c, next) => { await next(); c.header("Cache-Control", "no-store"); });
publicQprRouter.use("*", publicRateLimiter);

// Draft publik (model kejuhuran): baca/tulis draft cukup pilih nama.
// no-store — draft/roster tidak boleh tercache CDN. Rate limit autosave
// terpisah dari submit (banyak anggota satu Wi-Fi kampus).
publicQprRouter.get(
	"/:periodId/entries/:entryId/draft",
	describeRoute({
		summary: "Baca draft pengisian",
		description: "Tanpa login (model kejuhuran). Mengembalikan pertanyaan jalur responden, draft tersimpan, versi, dan progres. 409 bila sudah final.",
		tags: ["Public QPR"],
		responses: {
			200: { description: "Success", content: { "application/json": { schema: resolver(successWrapper(z.object({}))) } } },
			404: { description: "Periode/nama tidak tersedia" },
			409: { description: "Sudah mengirim final" },
		},
	}),
	async (c) => {
		const { periodId, entryId } = c.req.param();
		c.header("Cache-Control", "no-store");
		return ApiResponse.ok(c, "OK", await qprService.getDraft(getDb(c.env.DB), periodId, entryId));
	},
);

publicQprRouter.put(
	"/:periodId/entries/:entryId/draft",
	describeRoute({
		summary: "Simpan draft (autosave)",
		description: "Body: { expected_version, answers: [{ question_id, value }] }. CAS — versi usang ditolak 409 tanpa menimpa perangkat lain.",
		tags: ["Public QPR"],
		responses: {
			200: { description: "Success", content: { "application/json": { schema: resolver(successWrapper(z.object({}))) } } },
			404: { description: "Periode/nama tidak tersedia" },
			409: { description: "Konflik versi / sudah final" },
			422: { description: "Jawaban tidak valid" },
		},
	}),
	d1RateLimiter({ prefix: "public:qpr-draft", limit: 60, windowMs: 60_000 }),
	async (c) => {
		const { periodId, entryId } = c.req.param();
		c.header("Cache-Control", "no-store");
		const input = await parseJson(c, saveDraftSchema);
		return ApiResponse.ok(c, "Draft tersimpan", await qprService.saveDraft(getDb(c.env.DB), periodId, entryId, input));
	},
);

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

// Submit final v2 (snapshot berversi): exact set + batch atomik.
publicQprRouter.post(
	"/:periodId/submit-v2",
	describeRoute({
		summary: "Kirim penilaian final (format v2)",
		description: "Body: { entry_id, expected_version?, answers: [{ question_id, value }] }. Exact set jawaban wajib; sekali kirim terkunci atomik.",
		tags: ["Public QPR"],
		responses: {
			200: { description: "Success", content: { "application/json": { schema: resolver(successWrapper(z.object({}))) } } },
			404: { description: "Periode/nama tidak tersedia" },
			409: { description: "Sudah mengirim final" },
			422: { description: "Jawaban kurang/berlebih/tidak valid" },
		},
	}),
	d1RateLimiter({ prefix: "public:qpr", limit: 10, windowMs: 60_000 }),
	async (c) => {
		const { periodId } = c.req.param();
		c.header("Cache-Control", "no-store");
		const input = await parseJson(c, submitV2Schema);
		const result = await qprService.submitV2(getDb(c.env.DB), periodId, input);
		await recordAuditLog(c, { action: "qpr.public_submit_v2", resourceType: "qpr_entry", resourceId: result.entry_id });
		return ApiResponse.ok(c, "Penilaian terkirim. Terima kasih!", result);
	},
);

// --- Endpoint admin (qpr.manage + membership BPH, khusus BPH) ---

/**
 * Guard QPR: qpr.manage saja tidak cukup — platform_admin bisa punya membership
 * aktif di divisi lain. Kelola/hasil QPR hanya untuk membership aktif di
 * workspace slug "bph". activeDivisionId dipilih server (adminAuth), bukan klien.
 */
const requireBphQpr: MiddlewareHandler<AppContext> = async (c, next) => {
	const memberships = c.get("memberships") ?? [];
	const activeDivisionId = c.get("activeDivisionId");
	const active = memberships.find((m) => m.division.id === activeDivisionId);
	if (!active || active.division.slug !== "bph" || !active.permissions.includes("qpr.manage")) {
		throw ApiError.forbidden("Khusus BPH: tidak memiliki akses ke pengelolaan/hasil QPR");
	}
	await next();
};

export const adminQprRouter = new Hono<AppContext>();

adminQprRouter.use("*", async (c, next) => { await next(); c.header("Cache-Control", "no-store"); });
adminQprRouter.use("*", adminAuth);
adminQprRouter.use("*", requireBphQpr);

adminQprRouter.get(
	"/periods",
	describe("List periode QPR", "Termasuk hitungan sudah/belum mengisi.", successWrapper(z.array(z.object({})))),
	async (c) => ApiResponse.ok(c, "OK", await qprService.listPeriods(getDb(c.env.DB))),
);

adminQprRouter.post(
	"/periods",
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
	describe("Detail periode", "Periode + roster nama (sudah/belum isi).", successWrapper(z.object({})), { 404: { description: "Not found" } }),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		return ApiResponse.ok(c, "OK", await qprService.getPeriod(getDb(c.env.DB), id));
	},
);

adminQprRouter.put(
	"/periods/:id",
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
	describe("Buka periode", "Link publik mulai aktif.", successWrapper(z.object({}))),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		const result = await qprService.setStatus(getDb(c.env.DB), id, "open");
		await recordAuditLog(c, { action: "qpr.period_open", resourceType: "qpr_period", resourceId: id });
		return ApiResponse.ok(c, "Periode dibuka", result);
	},
);

adminQprRouter.post(
	"/periods/:id/close",
	describe("Tutup periode", "Link publik 404, submit ditolak.", successWrapper(z.object({}))),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		const result = await qprService.setStatus(getDb(c.env.DB), id, "closed");
		await recordAuditLog(c, { action: "qpr.period_close", resourceType: "qpr_period", resourceId: id });
		return ApiResponse.ok(c, "Periode ditutup", result);
	},
);

adminQprRouter.delete(
	"/periods/:id",
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
	describe("Rekap periode", "Partisipasi (sudah/belum isi, nama pending), rata-rata per kategori, catatan.", successWrapper(z.object({})), {
		404: { description: "Not found" },
	}),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		return ApiResponse.ok(c, "OK", await qprService.recap(getDb(c.env.DB), id));
	},
);

adminQprRouter.get(
	"/periods/:id/recap-v2",
	describe("Rekap v2 per pertanyaan", "Distribusi skor 1-5 + mean per pertanyaan, teks per target, partisipasi. Hanya jawaban final.", successWrapper(z.object({})), {
		404: { description: "Not found" },
	}),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		return ApiResponse.ok(c, "OK", await qprService.recapV2(getDb(c.env.DB), id));
	},
);

adminQprRouter.get(
	"/periods/:id/export",
	describe("Ekspor CSV", "Satu baris per submit final, kolom per pertanyaan jalur itu. Aman formula injection.", successWrapper(z.object({})), {
		404: { description: "Not found" },
	}),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		const { filename, csv } = await qprService.exportCsv(getDb(c.env.DB), id);
		await recordAuditLog(c, { action: "qpr.export", resourceType: "qpr_period", resourceId: id });
		return new Response("﻿" + csv, {
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": `attachment; filename="${filename}"`,
				"Cache-Control": "no-store",
			},
		});
	},
);

adminQprRouter.get("/periods/:id/preview",
	describe("Preview periode", "Blocker publikasi: target, roster, pemetaan divisi.", successWrapper(z.object({})), { 404: { description: "Not found" } }),
	async (c) => {
		const { id } = parseParams(c, idParamSchema);
		return ApiResponse.ok(c, "OK", await qprService.preview(getDb(c.env.DB), id));
	},
);

export const participationQprRouter = new Hono<AppContext>();
participationQprRouter.use("*", async (c, next) => { await next(); c.header("Cache-Control", "no-store"); });
participationQprRouter.use("*", adminAuth);
participationQprRouter.use("*", async (c, next) => {
 const active = (c.get("memberships") ?? []).find((m) => m.division.id === c.get("activeDivisionId") && m.status === "active");
 if (!active) throw ApiError.forbidden("Membership aktif diperlukan");
 await next();
});
participationQprRouter.get("/", describe("Partisipasi QPR", "Status pengisian per anggota divisi aktif.", successWrapper(z.object({}))), async (c) => {
	const active = (c.get("memberships") ?? []).find((m) => m.division.id === c.get("activeDivisionId") && m.status === "active");
	if (!active) throw ApiError.forbidden("Membership aktif diperlukan");
	return ApiResponse.ok(c, "OK", await qprService.participation(getDb(c.env.DB), active.division.slug));
});
participationQprRouter.get("/:periodId", describe("Partisipasi QPR per periode", "Status pengisian satu periode untuk divisi aktif.", successWrapper(z.object({})), { 404: { description: "Not found" } }), async (c) => {
	const active = (c.get("memberships") ?? []).find((m) => m.division.id === c.get("activeDivisionId") && m.status === "active");
	if (!active) throw ApiError.forbidden("Membership aktif diperlukan");
	return ApiResponse.ok(c, "OK", await qprService.participation(getDb(c.env.DB), active.division.slug, c.req.param("periodId")));
});
