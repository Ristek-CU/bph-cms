import { Hono } from "hono";
import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import type { AppContext } from "../../types";
import { adminAuth } from "../../middlewares/admin-auth";
import { requirePermission } from "../../middlewares/require-permission";
import { ApiResponse } from "../../shared/api-response";
import { recordAuditLog } from "../audit/audit.service";
import { getDb } from "../../db/connection";
import { eventService } from "./event.service";
import { successWrapper, errorWrapper, adminEventSchema } from "../openapi/schemas";
import {
	listEvents,
	createEvent,
	updateEvent,
	deleteEvent,
	deleteSession,
	addSession,
	updateSession,
	reorderSessions,
} from "./event.controller";

// describeRoute admin dengan response schema — docs Scalar detail lengkap.
//
// Catatan: body request TIDAK didokumentasikan di spec. hono-openapi v1.3 membangun
// `requestBody` dari validator middleware (`vValidator`), bukan dari key `request:` di
// describeRoute — key itu tidak dikenal dan akan lolos mentah ke spec sebagai field
// non-standar dengan schema `{"vendor":"zod"}` yang tidak ter-resolve. Menambah
// `vValidator` berarti menambah lapisan validasi kedua di atas `parseJson` yang sudah ada
// di controller, dan default-nya 400 sedangkan kontrak repo ini 422 (PLAN.md D4). Jadi
// itu keputusan tersendiri, bukan sekadar melengkapi docs. Aturan body didokumentasikan
// di `description` tiap endpoint dan di docs/API.md.
const ok = (
	summary: string,
	description: string,
	responseSchema: z.ZodTypeAny,
	extra: Record<number, { description: string }> = {},
) =>
	describeRoute({
		summary,
		description,
		tags: ["Admin Events"],
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
	ok(summary, description, successWrapper(adminEventSchema), extra);

export const adminEventRouter = new Hono<AppContext>();

// Semua endpoint admin wajib session valid + role admin (SDD §5/§6).
adminEventRouter.use("*", adminAuth);

adminEventRouter.get(
	"/",
	requirePermission("events.read.own_division"),
	ok(
		"List all events (admin, incl. drafts, with sessions)",
		"Semua event termasuk draft. status kolom: draft|published — status tampilan (ongoing/upcoming/past) dihitung klien dari waktu.",
		successWrapper(z.array(adminEventSchema)),
	),
	listEvents,
);

adminEventRouter.post(
	"/",
	requirePermission("events.create.own_division"),
	ok(
		"Create event (sessions inline optional)",
		"Slug auto dari judul bila kosong. Sesi harus di dalam rentang event. Aturan lintas-field yang tidak tergambar di schema: ends_at wajib setelah starts_at. 201 → event lengkap + sessions.",
		successWrapper(adminEventSchema),
		{ 201: { description: "Created" }, 409: { description: "Slug conflict" } },
	),
	createEvent,
);

adminEventRouter.put(
	"/:id",
	requirePermission("events.update.own_division", { resourceType: "event" }),
	ok(
		"Update event (partial)",
		"Body parsial — field mana pun boleh dikirim. Jika sessions dikirim, seluruh runsheet event diganti. Jika sessions tidak dikirim, rentang baru harus menampung sesi lama. Aturan lintas-field: bila starts_at dan ends_at dua-duanya dikirim, ends_at wajib lebih akhir.",
		successWrapper(adminEventSchema),
		{ 404: { description: "Not found" } },
	),
	updateEvent,
);

adminEventRouter.delete(
	"/:id",
	requirePermission("events.delete.own_division", { resourceType: "event" }),
	ok("Delete event + cascade sessions", "Hapus permanen, tidak ada soft delete.", successWrapper(z.object({})), {
		404: { description: "Not found" },
	}),
	deleteEvent,
);

adminEventRouter.post(
	"/:id/sessions",
	requirePermission("events.update.own_division", { resourceType: "event" }),
	ok(
		"Add session (must be within event range)",
		"Sesi wajib di dalam rentang event dan ends_at > starts_at (aturan lintas-field, tidak tergambar di schema). 201 → event + sessions terbaru.",
		successWrapper(adminEventSchema),
		{ 201: { description: "Created" }, 404: { description: "Event not found" } },
	),
	addSession,
);

adminEventRouter.put(
	"/:id/sessions/order",
	requirePermission("events.update.own_division", { resourceType: "event" }),
	ok(
		"Reorder sessions by id array",
		"Body: { session_ids: [id…] } — id asing/dua event → 422.",
		successWrapper(adminEventSchema),
	),
	reorderSessions,
);

adminEventRouter.put(
	"/sessions/:id",
	requirePermission("events.update.own_division", { resourceType: "session" }),
	ok(
		"Update session (partial)",
		"Body parsial: name/starts_at/ends_at/speaker/location/description. Aturan lintas-field: bila starts_at dan ends_at dua-duanya dikirim, ends_at wajib lebih akhir.",
		successWrapper(adminEventSchema),
	),
	updateSession,
);
adminEventRouter.delete(
	"/sessions/:id",
	requirePermission("events.update.own_division", { resourceType: "session" }),
	ok("Delete session", "Hapus satu sesi.", successWrapper(z.object({}))),
	deleteSession,
);

adminEventRouter.post(
	"/:id/publish",
	requirePermission("events.publish.own_division", { resourceType: "event" }),
	ok("Publish event (visible publicly)", "Event langsung terlihat di endpoint publik.", successWrapper(adminEventSchema), {
		404: { description: "Not found" },
	}),
	async (c) => {
		const id = c.req.param("id");
		const result = await eventService.setStatus(getDb(c.env.DB), id, "published");
		await recordAuditLog(c, {
			action: "events.publish",
			resourceType: "event",
			resourceId: id,
		});
		return ApiResponse.ok(c, "Event published", result);
	},
);

adminEventRouter.post(
	"/:id/unpublish",
	requirePermission("events.publish.own_division", { resourceType: "event" }),
	ok("Unpublish event (back to draft, hidden from public)", "Publik kembali 404.", successWrapper(adminEventSchema)),
	async (c) => {
		const id = c.req.param("id");
		const result = await eventService.setStatus(getDb(c.env.DB), id, "draft");
		await recordAuditLog(c, {
			action: "events.unpublish",
			resourceType: "event",
			resourceId: id,
		});
		return ApiResponse.ok(c, "Event unpublished", result);
	},
);
