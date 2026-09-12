import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { ApiError } from "../shared/api-error";
import { hasPermission } from "../shared/permissions";
import { eventSessions, events, forms, formSubmissions } from "../db/schema";
import type { AppContext } from "../types";

export type PermissionOptions = {
	scope?: "own_division" | "all";
	resourceType?: "event" | "session" | "division" | "form" | "submission";
};

/**
 * Validasi akses berbasis permission dan kepemilikan divisi.
 */
export const requirePermission = (
	requiredPermission: string,
	options: PermissionOptions = {},
): MiddlewareHandler<AppContext> => {
	return async (c, next) => {
		const userPermissions = c.get("permissions") ?? [];
		const activeDivisionId = c.get("activeDivisionId");

		// Permission lintas divisi boleh langsung lolos. Permission own_division
		// harus tetap cek resource/scope sebelum lolos.
		const base = requiredPermission.replace(/\.(all|own_division)$/, "");
		const requiresOwnDivision = requiredPermission.endsWith(".own_division");
		if (userPermissions.includes(`${base}.all`)) {
			return next();
		}
		if (!requiresOwnDivision && userPermissions.includes(requiredPermission)) {
			return next();
		}

		// Jika endpoint menargetkan resource spesifik (misal PUT /admin/events/:id)
		if (options.resourceType === "event") {
			const resourceId = c.req.param("id");
			if (resourceId) {
				const db = c.get("db");
				const [event] = await db
					.select({ divisionId: events.divisionId, status: events.status })
					.from(events)
					.where(eq(events.id, resourceId))
					.limit(1);

				if (!event) {
					throw ApiError.notFound("Event tidak ditemukan");
				}

				const isOwnDivision = Boolean(activeDivisionId && event.divisionId === activeDivisionId);
				if (!hasPermission(userPermissions, requiredPermission, { isOwnDivision, resourceStatus: event.status })) {
					throw ApiError.forbidden("Forbidden: tidak memiliki akses ke event divisi ini");
				}
				return next();
			}
		}

		if (options.resourceType === "session") {
			const resourceId = c.req.param("id");
			if (resourceId) {
				const db = c.get("db");
				const [session] = await db
					.select({ divisionId: events.divisionId, status: events.status })
					.from(eventSessions)
					.innerJoin(events, eq(eventSessions.eventId, events.id))
					.where(eq(eventSessions.id, resourceId))
					.limit(1);

				if (!session) {
					throw ApiError.notFound("Session tidak ditemukan");
				}

				const isOwnDivision = Boolean(activeDivisionId && session.divisionId === activeDivisionId);
				if (!hasPermission(userPermissions, requiredPermission, { isOwnDivision, resourceStatus: session.status })) {
					throw ApiError.forbidden("Forbidden: tidak memiliki akses ke sesi event divisi ini");
				}
				return next();
			}
		}

		if (options.resourceType === "form") {
			const resourceId = c.req.param("id");
			if (resourceId) {
				const db = c.get("db");
				const [form] = await db
					.select({ divisionId: forms.divisionId })
					.from(forms)
					.where(eq(forms.id, resourceId))
					.limit(1);

				if (!form) {
					throw ApiError.notFound("Form tidak ditemukan");
				}

				const isOwnDivision = Boolean(activeDivisionId && form.divisionId === activeDivisionId);
				if (!hasPermission(userPermissions, requiredPermission, { isOwnDivision })) {
					throw ApiError.forbidden("Forbidden: tidak memiliki akses ke form divisi ini");
				}
				return next();
			}
		}

		if (options.resourceType === "submission") {
			const resourceId = c.req.param("id");
			if (resourceId) {
				const db = c.get("db");
				const [submission] = await db
					.select({ divisionId: forms.divisionId })
					.from(formSubmissions)
					.innerJoin(forms, eq(formSubmissions.formId, forms.id))
					.where(eq(formSubmissions.id, resourceId))
					.limit(1);

				if (!submission) {
					throw ApiError.notFound("Submission tidak ditemukan");
				}

				const isOwnDivision = Boolean(activeDivisionId && submission.divisionId === activeDivisionId);
				if (!hasPermission(userPermissions, requiredPermission, { isOwnDivision })) {
					throw ApiError.forbidden("Forbidden: tidak memiliki akses ke respons divisi ini");
				}
				return next();
			}
		}

		// Pengecekan umum scope divisi
		const isOwnDivision = Boolean(activeDivisionId);
		if (!hasPermission(userPermissions, requiredPermission, { isOwnDivision, resourceStatus: "draft" })) {
			throw ApiError.forbidden("Forbidden: hak akses tidak mencukupi");
		}

		return next();
	};
};
