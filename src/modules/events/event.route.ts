import { Hono } from "hono";
import type { AppContext } from "../../types";
import { adminAuth } from "../../middlewares/admin-auth";
import { requireRole } from "../../middlewares/require-role";
import {
	createEvent,
	deleteEvent,
	deleteSession,
	addSession,
	reorderSessions,
	updateEvent,
	updateSession,
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
