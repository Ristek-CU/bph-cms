import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import { ApiError } from "../../shared/api-error";
import { ApiResponse } from "../../shared/api-response";
import { getDb } from "../../db/connection";
import { publicRateLimiter } from "../../middlewares/rate-limiter";
import { publicEventService } from "./event.public.service";
import type { AppContext } from "../../types";
import {
	successWrapper,
	errorWrapper,
	eventDetailSchema,
	eventListItemSchema,
	calendarItemSchema,
} from "../openapi/schemas";

// Query contract SDD §4.1: limit default 12, max 50.
const listQuerySchema = z.object({
	status: z.enum(["ongoing", "upcoming", "past"]).optional(),
	limit: z.coerce.number().int().positive().max(50).default(12),
	page: z.coerce.number().int().positive().default(1),
});

const monthQuerySchema = z.object({
	month: z.string().regex(/^\d{4}-\d{2}$/, "Must be YYYY-MM, e.g. 2026-09"),
});

// describeRoute dengan response schema — docs detail (Scalar) hidup dari sini.
const ok = (
	summary: string,
	description: string,
	schema: z.ZodTypeAny,
) =>
	describeRoute({
		summary,
		description,
		tags: ["Public Events"],
		responses: {
			200: {
				description: "Success",
				content: { "application/json": { schema: resolver(schema) } },
			},
			404: { description: "Not found (draft/missing)", content: { "application/json": { schema: resolver(errorWrapper) } } },
			422: {
				description: "Validation error",
				content: { "application/json": { schema: resolver(errorWrapper) } },
			},
		},
	});

export const publicEventRouter = new Hono<AppContext>();

// Endpoint publik di rate-limit per IP+path (SDD §6).
publicEventRouter.use("*", publicRateLimiter);

// PENTING: /calendar didaftarkan sebelum /:slug agar tidak tertelan param.
publicEventRouter.get(
	"/calendar",
	ok(
		"List events overlapping a month",
		"Event published yang rentangnya beririsan dengan bulan (YYYY-MM, WIB). Event multi-hari tetap masuk. Bulan kosong = items []",
		successWrapper(z.object({ items: z.array(calendarItemSchema) })),
	),
	async (c) => {
		const q = monthQuerySchema.safeParse(c.req.query());
		if (!q.success) {
			throw ApiError.validation(
				"Validation failed",
				z.flattenError(q.error).fieldErrors as Record<string, string[]>,
			);
		}
		const result = await publicEventService.calendar(getDb(c.env.DB), q.data.month);
		return ApiResponse.ok(c, "OK", result);
	},
);

publicEventRouter.get(
	"/",
	ok(
		"List published events (status computed server-side)",
		"Sortir: ongoing di atas → upcoming terdekat → past terbaru. Tanpa sessions.",
		successWrapper(
			z.object({
				items: z.array(eventListItemSchema),
				meta: z.object({
					current_page: z.number(),
					total: z.number(),
					per_page: z.number(),
				}),
			}),
		),
	),
	async (c) => {
		const q = listQuerySchema.safeParse(c.req.query());
		if (!q.success) {
			throw ApiError.validation(
				"Validation failed",
				z.flattenError(q.error).fieldErrors as Record<string, string[]>,
			);
		}
		const result = await publicEventService.list(getDb(c.env.DB), q.data);
		return ApiResponse.ok(c, "OK", result);
	},
);

publicEventRouter.get(
	"/:slug",
	ok(
		"Event detail with sessions ordered by starts_at",
		"404 jika draft atau tidak ada. status: ongoing|upcoming|past dihitung server (Asia/Jakarta).",
		successWrapper(eventDetailSchema),
	),
	async (c) => {
		const slug = c.req.param("slug");
		const result = await publicEventService.getBySlug(getDb(c.env.DB), slug);
		return ApiResponse.ok(c, "OK", result);
	},
);
