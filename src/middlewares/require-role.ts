import type { MiddlewareHandler } from "hono";
import { ApiError } from "../shared/api-error";
import type { AppContext } from "../types";

// Dipakai setelah adminAuth — butuh userRole di context.
export const requireRole =
	(...allowedRoles: string[]): MiddlewareHandler<AppContext> =>
	async (c, next) => {
		if (!allowedRoles.includes(c.get("userRole") ?? "")) {
			throw ApiError.forbidden("Forbidden: insufficient role");
		}
		return next();
	};
