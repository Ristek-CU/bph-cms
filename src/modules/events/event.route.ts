import { Hono } from "hono";
import type { AppContext } from "../../types";
import { adminAuth } from "../../middlewares/admin-auth";
import { requireRole } from "../../middlewares/require-role";

export const adminEventRouter = new Hono<AppContext>();

// Semua endpoint admin wajib session valid + role admin (SDD §5/§6).
adminEventRouter.use("*", adminAuth, requireRole("admin"));

