import { Hono } from "hono";
import type { Handler, Next } from "hono";
import { requestId } from "hono/request-id";
import { cors } from "hono/cors";
import { openAPIRouteHandler, describeRoute, resolver } from "hono-openapi";
import { successWrapper, errorWrapper, authDataSchema } from "./modules/openapi/schemas";
import { errorHandler } from "./shared/error-handler";
import { ApiError } from "./shared/api-error";
import { ApiResponse } from "./shared/api-response";
import { STATUS_CODES, type StatusCode } from "./shared/status-codes";
import { dbMiddleware } from "./db/connection";
import type { AppContext, Bindings, Variables } from "./types";

import { adminEventRouter } from "./modules/events/event.route";
import { publicEventRouter } from "./modules/events/event.public.route";
import { adminFormRouter, adminFormSubmissionRouter } from "./modules/forms/form.route";
import { publicFormRouter } from "./modules/forms/form.public.route";
import { adminQprRouter, publicQprRouter } from "./modules/qpr/qpr.route";
import { mediaRouter } from "./modules/media/media.route";
import { meRouter } from "./modules/me/me.route";
import { adminAccountRouter } from "./modules/accounts/account.route";
import { adminHandoffRouter, internalHandoffRouter } from "./modules/handoff/handoff.route";
import { eventService } from "./modules/events/event.service";
import { adminAuth } from "./middlewares/admin-auth";
import { d1RateLimiter } from "./middlewares/rate-limiter";
import { getDb } from "./db/connection";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", requestId());

// Header keamanan untuk semua respons yang dihasilkan Worker (API + /storage).
// HTML panel diserve Cloudflare Assets langsung, jadi tidak lewat sini.
app.use("*", async (c, next) => {
	await next();
	c.header("X-Content-Type-Options", "nosniff");
	c.header("Referrer-Policy", "no-referrer");
	c.header("X-Frame-Options", "DENY");
	c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
});

app.use("*", (c, next) => {
	const originHeader = c.req.header("origin");
	if (!originHeader) return next();

	const allowedOrigins = c.env.CORS_ORIGIN.split(",").map((url) => url.trim());
	return cors({
		origin: allowedOrigins,
		// X-Division-Id wajib masuk allowHeaders: adminAuth membacanya untuk pindah
		// divisi aktif, tanpa ini preflight lintas-origin menolaknya.
		allowHeaders: ["Content-Type", "Authorization", "X-Division-Id"],
		allowMethods: ["POST", "GET", "OPTIONS", "PUT", "DELETE"],
		credentials: true,
	})(c, next);
});

const v1 = new Hono<AppContext>();

v1.use("*", dbMiddleware);
v1.onError(errorHandler);

v1.get("/", (c) => ApiResponse.ok(c, "BPH CMS is running", { service: "bph-cms" }));

// Aset media publik (dipakai cover_image_url). Cache immutable — key uuid unik.
// D1 rate limit: dilayani sebelum publicEventRouter, jadi tidak kena limiter manapun.
// Browser yang me-render cover dari cache tetap lolos — cache-control immutable
// membuat fetch kedua tidak pernah sampai ke worker.
v1.get("/storage/*", d1RateLimiter({ prefix: "public:storage", limit: 120, windowMs: 60_000 }), async (c) => {
	const key = c.req.path.replace("/api/v1/storage/", "");
	if (!key || key.includes("..")) return c.notFound();

	const object = await c.env.BUCKET.get(key);
	if (!object) return c.notFound();

	return new Response(object.body, {
		headers: {
			"Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
});

v1.route("/events", publicEventRouter);
v1.route("/admin/events", adminEventRouter);
// Submissions sebelum /forms/:id supaya /forms/submissions/:id tidak tertelan.
v1.route("/admin/forms/submissions", adminFormSubmissionRouter);
v1.route("/admin/forms", adminFormRouter);
v1.route("/admin/qpr", adminQprRouter);
v1.route("/qpr", publicQprRouter);
v1.route("/forms", publicFormRouter);
v1.route("/admin/media", mediaRouter);
v1.route("/admin", adminAccountRouter);
v1.route("/admin", adminHandoffRouter);
v1.route("/internal", internalHandoffRouter);
v1.route("/me", meRouter);

// Spec OpenAPI + halaman docs hanya untuk email di allowlist (var DOCS_ALLOW_EMAILS,
// koma-separator). Spec dilindungi — tanpa Bearer valid + email terdaftar, docs
// tidak punya apa pun untuk dirender. Endpoint publik (/events) tetap terbuka.
const docsAccess = async (c: Parameters<Handler<AppContext>>[0], next: Next) => {
	if (c.req.method === "OPTIONS") return next(); // preflight CORS tidak bawa token
	// Cek allowlist disisipkan sebagai `next` milik adminAuth, bukan dijalankan
	// sesudahnya. Versi lama menjalankan handler lebih dulu lalu melempar 403 —
	// hasilnya tetap 403, tetapi spec sudah terlanjur dibuat untuk akun yang tidak
	// berwenang dan urutannya bergantung pada onError mengganti respons.
	return adminAuth(c, async () => {
		const allow = c.env.DOCS_ALLOW_EMAILS.split(",").map((e) => e.trim().toLowerCase());
		if (!allow.includes((c.get("userEmail") ?? "").toLowerCase())) {
			throw ApiError.forbidden("Forbidden: akun tidak berwenang membuka dokumentasi");
		}
		return next();
	});
};
v1.get("/openapi", docsAccess, (c, _next) =>
	openAPIRouteHandler(v1, {
		documentation: {
			info: {
				title: "BPH CMS API",
				version: "1.0.0",
				description: "CMS BPH SGA Cakrawala — Student Event module",
			},
			servers: [{ url: c.env.API_BASE_URL }],
		},
	})(c, _next),
);

// Dokumentasi API — Swagger UI self-host: /docs/ (aset panel/public/docs), login
// email allowlist (DOCS_ALLOW_EMAILS). Spec JSON: /api/v1/openapi (Bearer).
v1.get("/reference", (c) => c.redirect("/docs/", 302));

// Proxy login/daftar ke service auth via binding — admin panel SPA cukup satu origin.
const describeAuth = (summary: string, description: string) =>
	describeRoute({
		summary,
		description,
		tags: ["Auth"],
		responses: {
			200: {
				description: "Sukses — data.token dipakai sebagai Bearer untuk endpoint admin",
				content: { "application/json": { schema: resolver(successWrapper(authDataSchema)) } },
			},
			401: {
				description: "Email/password salah",
				content: { "application/json": { schema: resolver(errorWrapper) } },
			},
		},
	});

const proxyAuth =
	(options: { path: string; native?: boolean }) =>
	async (c: Parameters<import("hono").Handler>[0]) => {
		const raw = await c.req.text();
		// Tolak body kosong/bukan JSON dengan 400 rapi — sebelumnya 500 "Malformed JSON"
		// dari service auth saat parsing gagal.
		if (!raw || /{|\[/.test(raw) === false) {
			throw ApiError.badRequest("Body JSON wajib: { email, password }");
		}
		const res = await c.env.AUTH_SERVICE.fetch(
			// Path service auth redeploy: /v1/auth/* kini /v1/access/*
			new Request(`http://internal/v1/access/${options.path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: raw,
			}),
		);

		// sign-in dilayani authRouter service auth yang sudah membungkus respons jadi
		// { success, message, statusCode, data } — teruskan apa adanya.
		if (!options.native) {
			return new Response(res.body, {
				status: res.status,
				headers: { "Content-Type": "application/json" },
			});
		}

		// authRouter yang terdeploy TIDAK punya /sign-up (diverifikasi: 404 kosong,
		// jatuh ke wildcard better-auth). Yang hidup adalah endpoint native
		// /sign-up/email, dan dia membalas { token, user } polos tanpa wrapper.
		// Dibungkus ulang supaya kontrak publik /auth/sign-up tetap sama dengan
		// /auth/sign-in dan cocok dengan authDataSchema di spec OpenAPI.
		const text = await res.text();
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			throw ApiError.server("Service auth membalas respons non-JSON");
		}
		if (!res.ok) {
			const err = body as { message?: string } | null;
			throw new ApiError(
				res.status as StatusCode,
				err?.message || "Sign up gagal",
				body,
			);
		}
		return ApiResponse.ok(c, "Sign up berhasil", body);
	};

// Brute-force guard untuk proxy auth. Sebelumnya /auth/sign-in tidak dibatasi
// sama sekali (diverifikasi: puluhan percobaan beruntun semuanya lolos tanpa 429).
// Hono meng-cache body request, jadi membaca email di sini tidak menghabiskan
// body yang nanti dipakai proxyAuth.
const FIFTEEN_MIN = 15 * 60_000;
const authEmail = async (c: Parameters<Handler<AppContext>>[0]) => {
	try {
		const body = JSON.parse(await c.req.text()) as { email?: unknown };
		return String(body?.email ?? "").toLowerCase().trim().slice(0, 254);
	} catch {
		return "";
	}
};

// Dua lapis: per IP+email (blokir tebak password satu akun) dan per IP (blokir
// password spraying ke banyak email).
const signInPerEmailLimiter = d1RateLimiter({
	prefix: "auth:sign-in",
	limit: 20,
	windowMs: FIFTEEN_MIN,
	suffix: authEmail,
});
const signInPerIpLimiter = d1RateLimiter({
	prefix: "auth:sign-in-ip",
	limit: 60,
	windowMs: FIFTEEN_MIN,
});
const signUpLimiter = d1RateLimiter({
	prefix: "auth:sign-up",
	limit: 10,
	windowMs: FIFTEEN_MIN,
});

v1.post(
	"/auth/sign-in",
	signInPerEmailLimiter,
	signInPerIpLimiter,
	describeAuth(
		"Sign in (proxy ke service auth superapp)",
		"Body: { email, password }. 200 → { token, user }. Token dipakai: Authorization: Bearer <token> untuk semua endpoint admin.",
	),
	proxyAuth({ path: "sign-in" }),
);
v1.post(
	"/auth/sign-up",
	signUpLimiter,
	describeAuth(
		"Sign up (proxy ke endpoint native better-auth)",
		"Body: { name, email, password (min 8) }. User baru role 'user' di auth service; akses panel baru muncul setelah platform_admin membuat baris cms_memberships untuk user itu.",
	),
	proxyAuth({ path: "sign-up/email", native: true }),
);

app.route("/api/v1", v1);

// Halaman docs Swagger UI = aset statis panel/public/docs/index.html (URL /docs/).
// Route worker tidak dipakai: assets SPA routing intersepsi navigasi browser
// (sec-fetch-dest: document) sebelum worker jalan — /api-docs via worker tak pernah
// terlihat browser. Aset statis match persis, selalu diserve.

app.notFound((c) =>
	new ApiResponse({
		success: false,
		message: "Route not found",
		statusCode: STATUS_CODES.NOT_FOUND,
	}).send(c),
);

app.onError(errorHandler);

export default app;
