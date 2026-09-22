import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import type { AppContext } from "../../types";
import { adminAuth } from "../../middlewares/admin-auth";
import { requirePermission } from "../../middlewares/require-permission";
import { successWrapper, errorWrapper, adminInternalEventSchema, internalCalendarItemSchema } from "../openapi/schemas";
import {
	listInternalEvents,
	getInternalEvent,
	calendarInternalEvents,
	createInternalEvent,
	updateInternalEvent,
	deleteInternalEvent,
	addInternalSession,
	updateInternalSession,
	deleteInternalSession,
	reorderInternalSessions,
	setInternalEventStatus,
} from "./internal-event.controller";

// Internal Event (D-AK) — agenda internal organisasi: rapat, koordinasi,
// pencatatan. Bentuk endpoint dan body-nya SENGAJA identik dengan
// /admin/events supaya panel dan Roro cukup mengganti prefix.
//
// Yang berbeda hanya jangkauannya: tidak ada satu pun route di sini yang
// ter-mount di /api/v1/events, jadi internal event tidak punya jalur ke publik.
//
// Body request tidak didokumentasikan di spec OpenAPI — alasan dan detailnya
// sama persis dengan catatan di modules/events/event.route.ts (hono-openapi v1.3
// membangun requestBody dari vValidator, bukan dari key `request:`, dan
// vValidator membawa default 400 yang bertentangan dengan kontrak 422 repo ini).
const ok = (
	summary: string,
	description: string,
	responseSchema: z.ZodTypeAny,
	extra: Record<number, { description: string }> = {},
) =>
	describeRoute({
		summary,
		description,
		tags: ["Admin Internal Events"],
		security: [{ bearerAuth: [] }],
		responses: {
			200: { description: "Success", content: { "application/json": { schema: resolver(responseSchema) } } },
			401: { description: "Unauthorized", content: { "application/json": { schema: resolver(errorWrapper) } } },
			403: { description: "Forbidden (insufficient role)" },
			422: { description: "Validation error", content: { "application/json": { schema: resolver(errorWrapper) } } },
			...extra,
		},
	});

const eventOk = (summary: string, description: string, extra: Record<number, { description: string }> = {}) =>
	ok(summary, description, successWrapper(adminInternalEventSchema), extra);

export const adminInternalEventRouter = new Hono<AppContext>();

adminInternalEventRouter.use("*", adminAuth);

adminInternalEventRouter.get(
	"/",
	requirePermission("events.read.own_division"),
	ok(
		"List internal events (all divisions, incl. own drafts)",
		"K-2: internal event published milik SEMUA divisi ikut terbaca; draft hanya milik divisi sendiri (platform_admin melihat semua draft). Tiap item memuat division_id/division_name supaya panel bisa memutuskan hak tulis.",
		successWrapper(z.object({ items: z.array(adminInternalEventSchema) })),
	),
	listInternalEvents,
);

// Didaftarkan sebelum /:id supaya "calendar" tidak tertelan sebagai id.
adminInternalEventRouter.get(
	"/calendar",
	requirePermission("events.read.own_division"),
	ok(
		"Cross-division internal calendar",
		"Internal event published seluruh divisi yang rentangnya beririsan dengan bulan (YYYY-MM, WIB, default bulan berjalan) + division_id/division_name. Tanpa draft, tanpa sessions.",
		successWrapper(z.object({ items: z.array(internalCalendarItemSchema) })),
	),
	calendarInternalEvents,
);

adminInternalEventRouter.get(
	"/:id",
	requirePermission("events.read.own_division"),
	ok(
		"Get internal event detail with sessions",
		"Draft divisi lain dibalas 404, bukan 403 — keberadaannya tidak boleh terungkap.",
		successWrapper(adminInternalEventSchema),
		{ 404: { description: "Not found or not visible" } },
	),
	getInternalEvent,
);

adminInternalEventRouter.post(
	"/",
	requirePermission("events.create.own_division"),
	eventOk(
		"Create internal event (sessions inline optional)",
		"Body identik POST /admin/events. Slug auto dari judul bila kosong. Selalu dibuat sebagai DRAFT — terbit hanya lewat /:id/publish. Sesi harus di dalam rentang event. 201 → internal event lengkap + sessions.",
		{ 201: { description: "Created" }, 409: { description: "Slug conflict" } },
	),
	createInternalEvent,
);

adminInternalEventRouter.put(
	"/:id",
	requirePermission("events.update.own_division", { resourceType: "internal_event" }),
	eventOk(
		"Update internal event (partial)",
		"Body identik PUT /admin/events/:id. Jika sessions dikirim, seluruh runsheet diganti. Jika tidak, rentang baru harus menampung sesi lama.",
		{ 404: { description: "Not found" } },
	),
	updateInternalEvent,
);

adminInternalEventRouter.delete(
	"/:id",
	requirePermission("events.delete.own_division", { resourceType: "internal_event" }),
	ok(
		"Delete internal event + cascade sessions",
		"Hapus permanen, tidak ada soft delete. Tercatat di audit log.",
		successWrapper(z.object({})),
		{ 404: { description: "Not found" } },
	),
	deleteInternalEvent,
);

adminInternalEventRouter.post(
	"/:id/sessions",
	requirePermission("events.update.own_division", { resourceType: "internal_event" }),
	eventOk(
		"Add session (must be within event range)",
		"Sesi wajib di dalam rentang event dan ends_at > starts_at. 201 → internal event + sessions terbaru.",
		{ 201: { description: "Created" }, 404: { description: "Event not found" } },
	),
	addInternalSession,
);

adminInternalEventRouter.put(
	"/:id/sessions/order",
	requirePermission("events.update.own_division", { resourceType: "internal_event" }),
	eventOk(
		"Reorder sessions by id array",
		"Body: { session_ids: [id…] } — id asing/dua event → 422.",
	),
	reorderInternalSessions,
);

adminInternalEventRouter.put(
	"/sessions/:id",
	requirePermission("events.update.own_division", { resourceType: "internal_session" }),
	eventOk(
		"Update session (partial)",
		"Body parsial: name/starts_at/ends_at/speaker/location/description.",
	),
	updateInternalSession,
);

adminInternalEventRouter.delete(
	"/sessions/:id",
	requirePermission("events.update.own_division", { resourceType: "internal_session" }),
	ok("Delete session", "Hapus satu sesi runsheet.", successWrapper(z.object({}))),
	deleteInternalSession,
);

adminInternalEventRouter.post(
	"/:id/publish",
	requirePermission("events.publish.own_division", { resourceType: "internal_event" }),
	eventOk(
		"Publish internal event (visible to all SGA staff)",
		"Terbit INTERNAL: terbaca semua pengurus lintas divisi. TIDAK pernah muncul di endpoint publik maupun landing page.",
		{ 404: { description: "Not found" } },
	),
	setInternalEventStatus("published"),
);

adminInternalEventRouter.post(
	"/:id/unpublish",
	requirePermission("events.publish.own_division", { resourceType: "internal_event" }),
	eventOk(
		"Unpublish internal event (back to own-division draft)",
		"Kembali jadi draft — hanya divisi pemilik yang bisa melihat.",
	),
	setInternalEventStatus("draft"),
);
