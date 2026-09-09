import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { describeRoute } from "hono-openapi";
import { adminAuth } from "../../middlewares/admin-auth";
import { requirePermission } from "../../middlewares/require-permission";
import { ApiResponse } from "../../shared/api-response";
import { ApiError } from "../../shared/api-error";
import { parseJson } from "../../shared/parse-request";
import { divisions, cmsMemberships, auditLogs } from "../../db/schema";
import { recordAuditLog } from "../audit/audit.service";
import { createDivisionSchema, createMembershipSchema } from "./account.schema";
import type { AppContext } from "../../types";

// Error D1 berisi potongan SQL dan nama kolom — jangan pernah diteruskan ke klien.
// Cukup kenali pelanggaran unique supaya bisa dibalas 409 yang wajar.
// Drizzle membungkus error D1 ("Failed query: ...") dan menaruh penyebab asli di
// `.cause`, jadi rantainya harus ditelusuri, bukan cuma pesan terluar.
const isUniqueViolation = (err: unknown): boolean => {
	let current: any = err;
	for (let depth = 0; current && depth < 8; depth++) {
		if (typeof current.message === "string" && /UNIQUE constraint failed/i.test(current.message)) {
			return true;
		}
		current = current.cause;
	}
	return false;
};

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
		const body = await parseJson(c, createDivisionSchema);

		const db = c.get("db");
		const id = uuidv7();
		const now = new Date().toISOString();

		try {
			await db.insert(divisions).values({
				id,
				slug: body.slug,
				name: body.name,
				email: body.email?.trim() || null,
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
		} catch (err) {
			if (isUniqueViolation(err)) throw ApiError.conflict("Slug divisi sudah dipakai");
			throw err;
		}

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
		const body = await parseJson(c, createMembershipSchema);

		const db = c.get("db");

		// SQLite tidak menjamin foreign key ditegakkan di D1 — cek eksplisit supaya
		// membership tidak menunjuk divisi yang tidak ada.
		const [division] = await db
			.select({ id: divisions.id })
			.from(divisions)
			.where(eq(divisions.id, body.division_id))
			.limit(1);
		if (!division) {
			throw ApiError.validation("Validation failed", {
				division_id: ["Divisi tidak ditemukan"],
			});
		}

		const id = uuidv7();
		const now = new Date().toISOString();

		try {
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
		} catch (err) {
			if (isUniqueViolation(err)) {
				throw ApiError.conflict("User sudah punya membership di divisi ini");
			}
			throw err;
		}

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
