import { Hono } from "hono";
import { eq, lt } from "drizzle-orm";
import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import { adminAuth } from "../../middlewares/admin-auth";
import { d1RateLimiter } from "../../middlewares/rate-limiter";
import { ApiResponse } from "../../shared/api-response";
import { ApiError } from "../../shared/api-error";
import { parseJson } from "../../shared/parse-request";
import { recordAuditLog } from "../audit/audit.service";
import { workspaceHandoffs, workspaceOptions } from "../../db/schema";
import { successWrapper, errorWrapper } from "../openapi/schemas";
import type { AppContext } from "../../types";

// Kode handoff hidup +-60 detik (SDD §4.5). Cukup untuk satu putaran redirect
// panel -> /sso Advokasi -> tukar kode, tapi terlalu singkat untuk dipakai ulang
// oleh pihak yang mencegat URL.
const HANDOFF_TTL_MS = 60_000;

// Exchange adalah satu-satunya endpoint mutasi yang bisa dipanggil tanpa sesi user, dan
// prefix `/internal` cuma penamaan — route ini ter-mount di domain publik. Pertahanan
// yang sebenarnya tetap kode 32-byte + perbandingan secret konstan-waktu (brute-force
// tidak realistis), jadi limiter ini bukan pengganti keduanya; ini menahan pembanjiran
// log dan write ke tabel rate_limits.
//
// Limitnya longgar karena polenya server-to-server: worker dashboard tujuan memanggil
// satu kali per user pindah dashboard. 30 request / 5 menit per IP jauh di atas kebutuhan
// nyata, tapi cukup supaya endpoint ini tidak jadi satu-satunya jalur mutasi tanpa batas.
const exchangeLimiter = d1RateLimiter({
	prefix: "handoff:exchange",
	limit: 30,
	windowMs: 5 * 60_000,
});

const handoffRequestSchema = z.object({
	workspace_option_id: z.string().min(1, "workspace_option_id wajib diisi"),
});

const exchangeRequestSchema = z.object({
	code: z.string().min(1, "code wajib diisi"),
});

/** Kode acak entropi tinggi via WebCrypto (bukan node:crypto). */
const newHandoffCode = (): string => {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Perbandingan konstan-waktu supaya lama respons tidak membocorkan prefix secret. */
const safeEqual = (a: string, b: string): boolean => {
	const enc = new TextEncoder();
	const ua = enc.encode(a);
	const ub = enc.encode(b);
	if (ua.length !== ub.length) return false;
	let diff = 0;
	for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
	return diff === 0;
};

export const adminHandoffRouter = new Hono<AppContext>();

adminHandoffRouter.use("*", adminAuth);

adminHandoffRouter.post(
	"/workspace-handoff",
	describeRoute({
		summary: "Minta kode handoff sekali pakai ke dashboard eksternal",
		description:
			"Bearer. Hanya boleh untuk workspace milik divisi tempat user punya membership. " +
			"Membalas { redirect_to } = <workspace.url>/sso?code=<kode>. Kode hidup 60 detik dan sekali pakai.",
		tags: ["Handoff"],
		security: [{ bearerAuth: [] }],
		responses: {
			200: {
				description: "Kode dibuat",
				content: {
					"application/json": {
						schema: resolver(successWrapper(z.object({ redirect_to: z.string() }))),
					},
				},
			},
			401: { description: "Unauthorized", content: { "application/json": { schema: resolver(errorWrapper) } } },
			403: { description: "Bukan member divisi pemilik workspace" },
			404: { description: "Workspace tidak ada / tidak aktif" },
			422: { description: "Validation error / workspace bukan dashboard eksternal" },
		},
	}),
	async (c) => {
		const { workspace_option_id } = await parseJson(c, handoffRequestSchema);
		const db = c.get("db");

		const [ws] = await db
			.select()
			.from(workspaceOptions)
			.where(eq(workspaceOptions.id, workspace_option_id))
			.limit(1);
		if (!ws || !ws.isActive) throw ApiError.notFound("Workspace tidak ditemukan");

		if (ws.kind !== "external_dashboard" || !ws.url) {
			throw ApiError.validation("Validation failed", {
				workspace_option_id: ["Workspace ini bukan dashboard eksternal"],
			});
		}

		// Deny-by-default: izin diambil dari membership nyata atas divisi pemilik
		// workspace, bukan dari menyembunyikan menu di panel.
		const memberships = c.get("memberships") ?? [];
		const owns = memberships.some((m) => m.division.id === ws.divisionId);
		if (!owns) {
			throw ApiError.forbidden("Forbidden: bukan member divisi pemilik workspace ini");
		}

		const now = new Date();
		const nowIso = now.toISOString();
		const expiresIso = new Date(now.getTime() + HANDOFF_TTL_MS).toISOString();

		// Cleanup (T6): buang kode kadaluarsa supaya tabel tidak membengkak.
		// expires_at selalu ISO UTC ber-millisecond, jadi aman dibandingkan leksikografis.
		await db.delete(workspaceHandoffs).where(lt(workspaceHandoffs.expiresAt, nowIso)).run();

		const code = newHandoffCode();
		await db.insert(workspaceHandoffs).values({
			code,
			userId: c.get("userId") ?? "",
			userEmail: c.get("userEmail") ?? "",
			divisionId: ws.divisionId,
			targetWorkspaceId: ws.id,
			expiresAt: expiresIso,
			usedAt: null,
			createdAt: nowIso,
		});

		await recordAuditLog(c, {
			action: "workspace.handoff_create",
			resourceType: "workspace_handoff",
			resourceId: ws.id,
			metadata: { divisionId: ws.divisionId },
		});

		const base = ws.url.replace(/\/+$/, "");
		return ApiResponse.ok(c, "Handoff code dibuat", {
			redirect_to: `${base}/sso?code=${code}`,
		});
	},
);

export const internalHandoffRouter = new Hono<AppContext>();

internalHandoffRouter.post(
	"/handoff/exchange",
	exchangeLimiter,
	describeRoute({
		summary: "Tukar kode handoff (internal, bukan endpoint publik)",
		description:
			"Hanya boleh dipanggil worker dashboard tujuan (AdvocationDashboard) lewat shared secret " +
			"di header X-Handoff-Secret. Kode sekali pakai: penukaran kedua ditolak, kode kadaluarsa ditolak. " +
			"Dibatasi 30 request / 5 menit per IP.",
		tags: ["Handoff"],
		responses: {
			200: {
				description: "Kode valid, identitas user dikembalikan",
				content: {
					"application/json": {
						schema: resolver(
							successWrapper(z.object({ user_id: z.string(), email: z.string(), name: z.string().nullable() })),
						),
					},
				},
			},
			401: { description: "Shared secret absent/salah" },
			404: { description: "Kode tidak dikenal" },
			409: { description: "Kode sudah dipakai" },
			410: { description: "Kode kadaluarsa" },
			429: { description: "Melewati 30 request / 5 menit per IP" },
			503: { description: "HANDOFF_SHARED_SECRET belum dikonfigurasi (fail closed)" },
		},
	}),
	async (c) => {
		const configured = c.env.HANDOFF_SHARED_SECRET;
		if (!configured) {
			// Fail closed: tanpa secret, tidak ada yang boleh menukar kode.
			throw new ApiError(503, "Handoff exchange belum dikonfigurasi");
		}
		const provided = c.req.header("X-Handoff-Secret") ?? "";
		if (!provided || !safeEqual(provided, configured)) {
			throw ApiError.unauthorized("Handoff exchange menolak pemanggil ini");
		}

		const { code } = await parseJson(c, exchangeRequestSchema);
		const db = c.get("db");

		const [row] = await db
			.select()
			.from(workspaceHandoffs)
			.where(eq(workspaceHandoffs.code, code))
			.limit(1);
		if (!row) throw ApiError.notFound("Handoff code tidak dikenal");
		if (row.usedAt) throw ApiError.conflict("Handoff code sudah dipakai");
		if (Date.parse(row.expiresAt) <= Date.now()) throw new ApiError(410, "Handoff code kadaluarsa");

		const usedIso = new Date().toISOString();
		await db
			.update(workspaceHandoffs)
			.set({ usedAt: usedIso })
			.where(eq(workspaceHandoffs.code, code))
			.run();

		await recordAuditLog(c, {
			action: "workspace.handoff_exchange",
			resourceType: "workspace_handoff",
			resourceId: row.targetWorkspaceId,
			metadata: { userId: row.userId },
		});

		// name tidak tersedia sebelum D-A: Hub tidak menyimpan profil user, dan
		// auth service tidak punya endpoint baca-profil-by-id. Sisi tujuan boleh
		// fallback ke email sampai profil auth service tersambung.
		return ApiResponse.ok(c, "Handoff code ditukar", {
			user_id: row.userId,
			email: row.userEmail,
			name: null,
		});
	},
);
