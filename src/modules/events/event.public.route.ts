import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../../shared/api-error";
import { ApiResponse } from "../../shared/api-response";
import { getDb } from "../../db/connection";
import { publicEventService } from "./event.public.service";
import type { AppContext } from "../../types";

// Query contract SDD §4.1: limit default 12, max 50.
const listQuerySchema = z.object({
	status: z.enum(["ongoing", "upcoming", "past"]).optional(),
	limit: z.coerce.number().int().positive().max(50).default(12),
	page: z.coerce.number().int().positive().default(1),
});

const monthQuerySchema = z.object({
	month: z.string().regex(/^\d{4}-\d{2}$/, "Must be YYYY-MM, e.g. 2026-09"),
});

export const publicEventRouter = new Hono<AppContext>();

// PENTING: /calendar didaftarkan sebelum /:slug agar tidak tertelan param.
publicEventRouter.get("/calendar", async (c) => {
	const q = monthQuerySchema.safeParse(c.req.query());
	if (!q.success) {
		throw ApiError.validation(
			"Validation failed",
			z.flattenError(q.error).fieldErrors as Record<string, string[]>,
		);
	}
	const result = await publicEventService.calendar(getDb(c.env.DB), q.data.month);
	return ApiResponse.ok(c, "OK", result);
});

publicEventRouter.get("/", async (c) => {
	const q = listQuerySchema.safeParse(c.req.query());
	if (!q.success) {
		throw ApiError.validation(
			"Validation failed",
			z.flattenError(q.error).fieldErrors as Record<string, string[]>,
		);
	}
	const result = await publicEventService.list(getDb(c.env.DB), q.data);
	return ApiResponse.ok(c, "OK", result);
});

publicEventRouter.get("/:slug", async (c) => {
	const slug = c.req.param("slug");
	const result = await publicEventService.getBySlug(getDb(c.env.DB), slug);
	return ApiResponse.ok(c, "OK", result);
});
