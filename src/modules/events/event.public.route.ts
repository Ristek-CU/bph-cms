import { Hono } from "hono";
import type { AppContext } from "../../types";

// ponytail: stub M1 — diisi penuh di M4 (endpoint publik).
export const publicEventRouter = new Hono<AppContext>();
