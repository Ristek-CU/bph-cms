import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { cors } from "hono/cors";

import { errorHandler } from "./shared/error-handler";
import { ApiResponse } from "./shared/api-response";
import { STATUS_CODES } from "./shared/status-codes";
import { dbMiddleware } from "./db/connection";
import type { AppContext, Bindings, Variables } from "./types";

import { adminEventRouter } from "./modules/events/event.route";
import { publicEventRouter } from "./modules/events/event.public.route";

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

v1.route("/events", publicEventRouter);
v1.route("/admin/events", adminEventRouter);

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
