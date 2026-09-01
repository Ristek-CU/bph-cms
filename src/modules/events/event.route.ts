import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppContext } from "../../types";
import { adminAuth } from "../../middlewares/admin-auth";
import { requireRole } from "../../middlewares/require-role";
import { ApiResponse } from "../../shared/api-response";
import { getDb } from "../../db/connection";
import { eventService } from "./event.service";
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

// describeRoute minimal untuk admin endpoints.
const ok = (summary: string, extra: Record<number, { description: string }> = {}) =>
	describeRoute({
		summary,
		tags: ["Admin Events"],
		security: [{ bearerAuth: [] }],
		responses: {
			200: { description: "Success" },
			401: { description: "Unauthorized" },
			403: { description: "Forbidden (insufficient role)" },
			422: { description: "Validation error" },
			...extra,
		},
	});

export const adminEventRouter = new Hono<AppContext>();

// Semua endpoint admin wajib session valid + role admin (SDD §5/§6).
adminEventRouter.use("*", adminAuth, requireRole("admin"));

adminEventRouter.get("/", ok("List all events (admin, incl. drafts, with sessions)"), listEvents);
adminEventRouter.post(
	"/",
	ok("Create event (sessions inline optional)", { 201: { description: "Created" }, 409: { description: "Slug conflict" } }),
	createEvent,
);
adminEventRouter.put(
	"/:id",
	ok("Update event (partial)", { 404: { description: "Not found" } }),
	updateEvent,
);
adminEventRouter.delete("/:id", ok("Delete event + cascade sessions", { 404: { description: "Not found" } }), deleteEvent);
adminEventRouter.post("/:id/sessions", ok("Add session (must be within event range)", { 404: { description: "Event not found" } }), addSession);
adminEventRouter.put("/:id/sessions/order", ok("Reorder sessions by id array"), reorderSessions);
adminEventRouter.put("/sessions/:id", ok("Update session"), updateSession);
adminEventRouter.delete("/sessions/:id", ok("Delete session"), deleteSession);

adminEventRouter.post(
	"/:id/publish",
	ok("Publish event (visible publicly)", { 404: { description: "Not found" } }),
	async (c) => {
		const id = c.req.param("id");
		const result = await eventService.setStatus(getDb(c.env.DB), id, "published");
		return ApiResponse.ok(c, "Event published", result);
	},
);

adminEventRouter.post(
	"/:id/unpublish",
	ok("Unpublish event (back to draft, hidden from public)"),
	async (c) => {
		const id = c.req.param("id");
		const result = await eventService.setStatus(getDb(c.env.DB), id, "draft");
		return ApiResponse.ok(c, "Event unpublished", result);
	},
);


adminEventRouter.post("/:id/publish", async (c) => {
	const { id } = c.req.param() as { id: string };
	const result = await eventService.setStatus(getDb(c.env.DB), id, "published");
	return ApiResponse.ok(c, "Event published", result);
});

adminEventRouter.post("/:id/unpublish", async (c) => {
	const { id } = c.req.param() as { id: string };
	const result = await eventService.setStatus(getDb(c.env.DB), id, "draft");
	return ApiResponse.ok(c, "Event unpublished", result);
});
