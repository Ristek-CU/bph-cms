import { Hono } from "hono";
import type { AppContext } from "../../types";
import { adminAuth } from "../../middlewares/admin-auth";
import { requireRole } from "../../middlewares/require-role";
import { ApiResponse } from "../../shared/api-response";
import { getDb } from "../../db/connection";
import { eventService } from "./event.service";
import {
	createEvent,
	deleteEvent,
	deleteSession,
	addSession,
	updateEvent,
	updateSession,
	reorderSessions,
} from "./event.controller";

export const adminEventRouter = new Hono<AppContext>();

// Semua endpoint admin wajib session valid + role admin (SDD §5/§6).
adminEventRouter.use("*", adminAuth, requireRole("admin"));

adminEventRouter.post("/", createEvent);
adminEventRouter.put("/:id", updateEvent);
adminEventRouter.delete("/:id", deleteEvent);
adminEventRouter.post("/:id/sessions", addSession);
adminEventRouter.put("/:id/sessions/order", reorderSessions);
adminEventRouter.put("/sessions/:id", updateSession);
adminEventRouter.delete("/sessions/:id", deleteSession);

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
