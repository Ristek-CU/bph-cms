import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { adminAuth } from "../../middlewares/admin-auth";
import { ApiResponse } from "../../shared/api-response";
import { workspaceOptions } from "../../db/schema";
import type { AppContext } from "../../types";

export const meRouter = new Hono<AppContext>();

meRouter.use("*", adminAuth);

meRouter.get(
	"/",
	describeRoute({
		summary: "Current user profile, CMS memberships, and workspace options",
		description: "Endpoint identitas user admin untuk menentukan permission dan menu dashboard.",
		tags: ["Me"],
		security: [{ bearerAuth: [] }],
	}),
	async (c) => {
		const userId = c.get("userId") ?? "";
		const userEmail = c.get("userEmail") ?? "";
		const userName = c.get("userName") ?? "";
		const userRole = c.get("userRole") ?? "user";
		const memberships = c.get("memberships") ?? [];
		const activeDivisionId = c.get("activeDivisionId");

		const db = c.get("db");
		let userWorkspaces: Array<{
			id: string | null;
			label: string;
			kind: "cms_hub" | "external_dashboard";
			url: string | null;
		}> = [];

		if (activeDivisionId) {
			const rows = await db
				.select()
				.from(workspaceOptions)
				.where(eq(workspaceOptions.divisionId, activeDivisionId))
				.orderBy(asc(workspaceOptions.sortOrder));

			userWorkspaces = rows
				.filter((w) => w.isActive)
				.map((w) => ({
					// id dibutuhkan panel untuk meminta kode handoff (POST /admin/workspace-handoff).
					id: w.id,
					label: w.label,
					kind: w.kind as "cms_hub" | "external_dashboard",
					url: w.url,
				}));
		}

		if (userWorkspaces.length === 0) {
			userWorkspaces = [{ id: null, label: "SGA CMS Hub", kind: "cms_hub", url: null }];
		}

		// Link "Dokumentasi API" di panel hanya tampil untuk email di allowlist
		// (sumber kebenaran sama dengan gate /api/v1/openapi di index.ts).
		const docsAllow = (c.env.DOCS_ALLOW_EMAILS ?? "")
			.split(",")
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean);

		return ApiResponse.ok(c, "OK", {
			user: {
				id: userId,
				email: userEmail,
				name: userName || userEmail.split("@")[0] || "User",
				role: userRole,
			},
			can_access_docs: docsAllow.includes(userEmail.toLowerCase()),
			active_division_id: activeDivisionId,
			memberships: memberships.map((m) => ({
				division: m.division,
				role: m.role,
				permissions: m.permissions,
			})),
			workspace_options: userWorkspaces,
		});
	},
);
