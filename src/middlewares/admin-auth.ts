import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { ApiError } from "../shared/api-error";
import { cmsMemberships, divisions } from "../db/schema";
import { ROLE_PERMISSIONS } from "../shared/permissions";
import type { AppContext, UserMembership } from "../types";

/**
 * Validasi session admin via service binding AUTH_SERVICE.
 * Memuat profil user dan membership CMS, lalu menetapkan permission dan activeDivisionId.
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

	let userId = "";
	let userRole = "user";
	let userEmail = "";
	const allowDevAuth = c.env.ALLOW_DEV_AUTH === "true";

	try {
		const sessionResponse = await c.env.AUTH_SERVICE.fetch(
			new Request("http://internal/v1/access/session", { headers: sessionHeaders }),
		);

		if (sessionResponse.ok) {
			const body = (await sessionResponse.json()) as {
				data: { user: { id: string; role: string; email?: string } } | null;
			};
			if (body?.data?.user) {
				userId = body.data.user.id;
				userRole = body.data.user.role;
				userEmail = body.data.user.email ?? "";
			}
		}
	} catch {
		// AUTH_SERVICE not connected in local dev fallback
	}

	// Fallback hanya untuk dev lokal eksplisit. Jangan aktifkan di production.
	if (allowDevAuth && !userId && authHeader?.startsWith("Bearer ")) {
		const rawToken = authHeader.replace("Bearer ", "").trim();
		if (rawToken === "dev-token" || rawToken.startsWith("dev-")) {
			userId = "01990000-0000-7000-8000-000000000001";
			userEmail = "bph@cakrawala.com";
			userRole = "admin";
		}
	}

	if (!userId) {
		throw ApiError.unauthorized();
	}

	c.set("userId", userId);
	c.set("userRole", userRole);
	c.set("userEmail", userEmail);

	// Load membership dari CMS Hub database
	const db = c.get("db");
	const rows = await db
		.select({
			membership: cmsMemberships,
			division: divisions,
		})
		.from(cmsMemberships)
		.innerJoin(divisions, eq(cmsMemberships.divisionId, divisions.id))
		.where(eq(cmsMemberships.userId, userId));

	let memberships: UserMembership[] = rows
		.filter((r) => r.membership.status === "active" && r.division.isActive)
		.map((r) => {
			const permissions = ROLE_PERMISSIONS[r.membership.role] ?? [];
			return {
				division: {
					id: r.division.id,
					slug: r.division.slug,
					name: r.division.name,
					email: r.division.email,
					dashboardUrl: r.division.dashboardUrl,
				},
				role: r.membership.role as UserMembership["role"],
				status: r.membership.status as UserMembership["status"],
				permissions,
			};
		});

	// Bootstrap awal: hanya akun BPH yang boleh jadi platform_admin bila membership
	// belum dibuat. Akun divisi lain wajib punya cms_membership eksplisit.
	if (memberships.length === 0) {
		const [bph] = await db.select().from(divisions).where(eq(divisions.slug, "bph")).limit(1);
		if (bph && userEmail.toLowerCase() === "bph@cakrawala.com") {
			memberships = [
				{
					division: {
						id: bph.id,
						slug: bph.slug,
						name: bph.name,
						email: bph.email,
						dashboardUrl: bph.dashboardUrl,
					},
					role: "platform_admin",
					status: "active",
					permissions: ROLE_PERMISSIONS.platform_admin,
				},
			];
		}
	}

	c.set("memberships", memberships);

	// Tentukan active division (header X-Division-Id atau first membership)
	const requestedDivisionId = c.req.header("X-Division-Id");
	const activeMembership =
		memberships.find((m) => m.division.id === requestedDivisionId || m.division.slug === requestedDivisionId) ||
		memberships[0];

	if (activeMembership) {
		c.set("activeDivisionId", activeMembership.division.id);
		c.set("permissions", activeMembership.permissions);
	} else {
		c.set("permissions", []);
	}

	return next();
};
