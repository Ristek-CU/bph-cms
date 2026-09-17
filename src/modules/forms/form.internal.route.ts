import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { getDb } from "../../db/connection";
import { forms } from "../../db/schema";
import { ApiResponse } from "../../shared/api-response";
import { ApiError } from "../../shared/api-error";
import { parseJson } from "../../shared/parse-request";
import { recordAuditLog } from "../audit/audit.service";
import { formService } from "./form.service";
import { fieldInputSchema } from "./form.schema";
import { successWrapper, errorWrapper } from "../openapi/schemas";
import type { AppContext } from "../../types";
import type { Db } from "../../db/connection";
import type { Handler } from "hono";

// Endpoint kelola form Student Voice dari AdvocationDashboard (fitur advokasi).
// Form hidup di CMS Hub, tapi dashboard advo yang mengelolanya. Autentikasi
// server-to-server: shared secret yang sama dengan handoff exchange
// (X-Handoff-Secret), bukan session user — request datang dari worker advo
// atas nama admin yang sudah login di sana.

/** Perbandingan konstan-waktu — sama dengan handoff.route.ts. */
const safeEqual = (a: string, b: string): boolean => {
	const enc = new TextEncoder();
	const ua = enc.encode(a);
	const ub = enc.encode(b);
	const maxLen = Math.max(ua.length, ub.length);
	let diff = ua.length ^ ub.length;
	for (let i = 0; i < maxLen; i++) diff |= (ua[i] ?? 0) ^ (ub[i] ?? 0);
	return diff === 0;
};

const guardHandoff = (c: Parameters<Handler<AppContext>>[0]): void => {
	const configured = c.env.HANDOFF_SHARED_SECRET;
	if (!configured) throw new ApiError(503, "Handoff exchange belum dikonfigurasi");
	const provided = c.req.header("X-Handoff-Secret") ?? "";
	if (!provided || !safeEqual(provided, configured)) {
		throw ApiError.unauthorized("Internal form API menolak pemanggil ini");
	}
};

const findFormBySlug = async (db: Db, slug: string) => {
	const [form] = await db.select().from(forms).where(eq(forms.slug, slug)).limit(1);
	if (!form) throw ApiError.notFound("Form tidak ditemukan.");
	return form;
};

// Kontrak body update — subset updateFormSchema (tanpa title/slug/jadwal: itu
// konsep campaign advo, kelola via Student Voice Studio bila perlu).
const updateFormBySlugSchema = z.object({
	description: z.string().max(5000).nullish(),
	thank_you_message: z.string().trim().max(500).optional(),
	background_color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, "Must be hex color")
		.optional(),
	fields: z.array(fieldInputSchema).max(100).optional(),
});

export const internalFormRouter = new Hono<AppContext>();

internalFormRouter.use("*", (c, next) => {
	guardHandoff(c);
	return next();
});

internalFormRouter.get(
	"/forms/:slug",
	describeRoute({
		summary: "Baca form publik by slug (internal advo)",
		description: "Server-to-server dari AdvocationDashboard via X-Handoff-Secret.",
		tags: ["Internal"],
		responses: {
			200: { description: "Form + fields", content: { "application/json": { schema: resolver(successWrapper(z.object({}))) } } },
			401: { description: "Shared secret absent/salah", content: { "application/json": { schema: resolver(errorWrapper) } } },
			404: { description: "Form tidak ada" },
		},
	}),
	async (c) => {
		const form = await findFormBySlug(getDb(c.env.DB), c.req.param("slug"));
		return ApiResponse.ok(c, "OK", await formService.get(getDb(c.env.DB), form.id));
	},
);

internalFormRouter.put(
	"/forms/:slug",
	describeRoute({
		summary: "Update form by slug (internal advo)",
		description: "Body subset updateFormSchema. Audit log action forms.update_internal.",
		tags: ["Internal"],
		responses: {
			200: { description: "Form updated", content: { "application/json": { schema: resolver(successWrapper(z.object({}))) } } },
			401: { description: "Shared secret absent/salah", content: { "application/json": { schema: resolver(errorWrapper) } } },
			404: { description: "Form tidak ada" },
			422: { description: "Validation error" },
		},
	}),
	async (c) => {
		const input = await parseJson(c, updateFormBySlugSchema);
		const db = getDb(c.env.DB);
		const form = await findFormBySlug(db, c.req.param("slug"));

		await formService.update(db, form.id, input);
		await recordAuditLog(c, {
			action: "forms.update_internal",
			resourceType: "form",
			resourceId: form.id,
			metadata: { via: "advocation-dashboard" },
		});

		return ApiResponse.ok(c, "Form updated", await formService.get(db, form.id));
	},
);
