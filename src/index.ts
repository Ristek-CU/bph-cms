import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { cors } from "hono/cors";
import { openAPIRouteHandler, describeRoute, resolver } from "hono-openapi";
import { successWrapper, errorWrapper, authDataSchema } from "./modules/openapi/schemas";
import { errorHandler } from "./shared/error-handler";
import { ApiResponse } from "./shared/api-response";
import { STATUS_CODES } from "./shared/status-codes";
import { dbMiddleware } from "./db/connection";
import type { AppContext, Bindings, Variables } from "./types";

import { adminEventRouter } from "./modules/events/event.route";
import { publicEventRouter } from "./modules/events/event.public.route";
import { mediaRouter } from "./modules/media/media.route";
import { eventService } from "./modules/events/event.service";
import { adminAuth } from "./middlewares/admin-auth";
import { requireRole } from "./middlewares/require-role";
import { getDb } from "./db/connection";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", requestId());

app.use("*", (c, next) => {
	const originHeader = c.req.header("origin");
	if (!originHeader) return next();

	const allowedOrigins = c.env.CORS_ORIGIN.split(",").map((url) => url.trim());
	return cors({
		origin: allowedOrigins,
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["POST", "GET", "OPTIONS", "PUT", "DELETE"],
		credentials: true,
	})(c, next);
});

const v1 = new Hono<AppContext>();

v1.use("*", dbMiddleware);
v1.onError(errorHandler);

v1.get("/", (c) => ApiResponse.ok(c, "BPH CMS is running", { service: "bph-cms" }));

// Aset media publik (dipakai cover_image_url). Cache immutable — key uuid unik.
v1.get("/storage/*", async (c) => {
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
v1.route("/admin/media", mediaRouter);

v1.get("/openapi", (c, _next) =>
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

v1.get("/reference", (c) => {
	// Scalar self-host — bundle dari aset panel (/vendor/scalar-api-reference.js),
	// tanpa CDN eksternal (jaringan kampus sering blokir jsdelivr).
	// Upgrade: unduh versi baru dari https://cdn.jsdelivr.net/npm/@scalar/api-reference
	// ke panel/public/vendor/scalar-api-reference.js.
	return c.html(`<!doctype html>
<html>
  <head>
    <title>BPH CMS — API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/vendor/scalar-api-reference.js"></script>
    <script>
      Scalar.createApiReference('#app', {
        url: '/api/v1/openapi',
        _integration: 'hono',
      });
    </script>
  </body>
</html>`);
});

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

const proxyAuth = (path: string) => async (c: Parameters<import("hono").Handler>[0]) => {
	const res = await c.env.AUTH_SERVICE.fetch(
		new Request(`http://internal/v1/auth/${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: await c.req.text(),
		}),
	);
	return new Response(res.body, {
		status: res.status,
		headers: { "Content-Type": "application/json" },
	});
};

v1.post(
	"/auth/sign-in",
	describeAuth(
		"Sign in (proxy ke service auth superapp)",
		"Body: { email, password }. 200 → { token, user }. Token dipakai: Authorization: Bearer <token> untuk semua endpoint admin.",
	),
	proxyAuth("sign-in"),
);
v1.post(
	"/auth/sign-up",
	describeAuth(
		"Sign up (proxy)",
		"Body: { name, email, password (min 8) }. User baru role 'user' — perlu dijadikan admin oleh pengelola untuk akses panel.",
	),
	proxyAuth("sign-up"),
);

app.route("/api/v1", v1);

app.notFound((c) =>
	new ApiResponse({
		success: false,
		message: "Route not found",
		statusCode: STATUS_CODES.NOT_FOUND,
	}).send(c),
);

app.onError(errorHandler);

export default app;
