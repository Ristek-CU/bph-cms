import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { describeRoute } from "hono-openapi";
import { adminAuth } from "../../middlewares/admin-auth";
import { requirePermission } from "../../middlewares/require-permission";
import { ApiResponse } from "../../shared/api-response";
import { ApiError } from "../../shared/api-error";
import { divisions, cmsMemberships, auditLogs } from "../../db/schema";
import { recordAuditLog } from "../audit/audit.service";
import type { AppContext } from "../../types";

export const adminAccountRouter = new Hono<AppContext>();

adminAccountRouter.use("*", adminAuth);

// GET /api/v1/admin/divisions
adminAccountRouter.get(
	"/divisions",
	requirePermission("accounts.manage"),
	describeRoute({
		summary: "List all divisions",
		tags: ["Admin Accounts"],
		security: [{ bearerAuth: [] }],
	}),
	async (c) => {
		const db = c.get("db");
		const allDivisions = await db.select().from(divisions);
		return ApiResponse.ok(c, "OK", allDivisions);
	},
);

// POST /api/v1/admin/divisions
adminAccountRouter.post(
	"/divisions",
	requirePermission("accounts.manage"),
	describeRoute({
		summary: "Create division",
		tags: ["Admin Accounts"],
		security: [{ bearerAuth: [] }],
	}),
	async (c) => {
		const body = (await c.req.json()) as { slug: string; name: string; email?: string };
		if (!body.slug || !body.name) {
			throw ApiError.validation("Data divisi tidak lengkap", {
				slug: [!body.slug ? "Slug wajib diisi" : ""].filter(Boolean),
				name: [!body.name ? "Nama wajib diisi" : ""].filter(Boolean),
			});
		}

		const db = c.get("db");
		const id = uuidv7();
		const now = new Date().toISOString();

		await db.insert(divisions).values({
			id,
			slug: body.slug.toLowerCase().trim(),
			name: body.name.trim(),
			email: body.email?.trim() || null,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});

		await recordAuditLog(c, {
			action: "divisions.create",
			resourceType: "division",
			resourceId: id,
			metadata: { slug: body.slug, name: body.name },
		});

		const [created] = await db.select().from(divisions).where(eq(divisions.id, id));
		return ApiResponse.created(c, "Divisi berhasil dibuat", created);
	},
);

// GET /api/v1/admin/accounts
adminAccountRouter.get(
	"/accounts",
	requirePermission("accounts.manage"),
	describeRoute({
		summary: "List memberships/accounts",
		tags: ["Admin Accounts"],
		security: [{ bearerAuth: [] }],
	}),
	async (c) => {
		const db = c.get("db");
		const rows = await db
			.select({
				membership: cmsMemberships,
				division: divisions,
			})
			.from(cmsMemberships)
			.innerJoin(divisions, eq(cmsMemberships.divisionId, divisions.id));

		const items = rows.map((r) => ({
			id: r.membership.id,
			user_id: r.membership.userId,
			user_email: r.membership.userEmail,
			division: {
				id: r.division.id,
				slug: r.division.slug,
				name: r.division.name,
			},
			role: r.membership.role,
			status: r.membership.status,
			created_at: r.membership.createdAt,
		}));

		return ApiResponse.ok(c, "OK", items);
	},
);

// POST /api/v1/admin/accounts
adminAccountRouter.post(
	"/accounts",
	requirePermission("accounts.manage"),
	describeRoute({
		summary: "Assign/create membership for user",
		tags: ["Admin Accounts"],
		security: [{ bearerAuth: [] }],
	}),
	async (c) => {
		const body = (await c.req.json()) as {
			user_id: string;
			user_email: string;
			division_id: string;
			role: "platform_admin" | "division_admin" | "contributor" | "viewer";
		};

		if (!body.user_id || !body.user_email || !body.division_id || !body.role) {
			throw ApiError.validation("Data akun tidak lengkap");
		}

		const db = c.get("db");
		const id = uuidv7();
		const now = new Date().toISOString();

		await db.insert(cmsMemberships).values({
			id,
			userId: body.user_id,
			userEmail: body.user_email.toLowerCase().trim(),
			divisionId: body.division_id,
			role: body.role,
			status: "active",
			createdAt: now,
			updatedAt: now,
		});

		await recordAuditLog(c, {
			action: "accounts.membership_create",
			resourceType: "cms_membership",
			resourceId: id,
			metadata: { email: body.user_email, divisionId: body.division_id, role: body.role },
		});

		return ApiResponse.created(c, "Membership berhasil dibuat", { id });
	},
);

// GET /api/v1/admin/audit-logs
adminAccountRouter.get(
	"/audit-logs",
	requirePermission("audit.read"),
	describeRoute({
		summary: "List audit logs",
		tags: ["Admin Accounts"],
		security: [{ bearerAuth: [] }],
	}),
	async (c) => {
		const db = c.get("db");
		const logs = await db.select().from(auditLogs).limit(50);
		return ApiResponse.ok(c, "OK", logs);
	},
);

// GET /api/v1/admin/qpr
adminAccountRouter.get(
	"/qpr",
	requirePermission("qpr.manage"),
	describeRoute({
		summary: "QPR Module API (BPH Only)",
		tags: ["Admin QPR"],
		security: [{ bearerAuth: [] }],
	}),
	async (c) => {
		return ApiResponse.ok(c, "QPR Module Data (BPH Only)", {
			status: "active",
			evaluations: [],
		});
	},
);
