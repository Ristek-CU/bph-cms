import type { MiddlewareHandler } from "hono";
import { ApiError } from "../shared/api-error";
import type { AppContext } from "../types";

/**
 * Validasi session admin via service binding AUTH_SERVICE (service auth superapp,
 * better-auth + bearer plugin). Pola sama dengan gateway-api/src/middlewares/auth.ts.
 *
 * Forward Authorization/Cookie ke GET /v1/auth/session; non-OK atau data.user kosong
 * dianggap 401. userId/userRole di-set ke context untuk requireRole.
 */
export const adminAuth: MiddlewareHandler<AppContext> = async (c, next) => {
	const authHeader = c.req.header("Authorization");
	const cookieHeader = c.req.header("Cookie");

	if (!authHeader?.startsWith("Bearer ") && !cookieHeader) {
		throw ApiError.unauthorized();
	}

	const sessionHeaders: Record<string, string> = {};
	if (authHeader) sessionHeaders["Authorization"] = authHeader;
	if (cookieHeader) sessionHeaders["Cookie"] = cookieHeader;

	const sessionResponse = await c.env.AUTH_SERVICE.fetch(
		new Request("http://internal/v1/auth/session", { headers: sessionHeaders }),
	);

	if (!sessionResponse.ok) {
		throw ApiError.unauthorized();
	}

	const body = (await sessionResponse.json()) as {
		data: { user: { id: string; role: string } } | null;
	};

	if (!body?.data?.user) {
		throw ApiError.unauthorized();
	}

	c.set("userId", body.data.user.id);
	c.set("userRole", body.data.user.role);

	return next();
};
