import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { cors } from "hono/cors";
import { openAPIRouteHandler } from "hono-openapi";
import { Scalar } from "@scalar/hono-api-reference";

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
	// @ts-expect-error Scalar plugin typing expects generic Env; runtime-compatible with AppContext
	return Scalar({ theme: "saturn", url: "/api/v1/openapi" })(c, async () => {});
});

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
