import type { Context } from "hono";
import { ApiResponse } from "../../shared/api-response";
import { ApiError } from "../../shared/api-error";
import { parseJson, parseParams } from "../../shared/parse-request";
import { getDb } from "../../db/connection";
import { recordAuditLog } from "../audit/audit.service";
import { internalEventService, type InternalEventViewer } from "./internal-event.service";
import {
	createEventSchema,
	createSessionSchema,
	idParamSchema,
	reorderSessionsSchema,
	updateEventSchema,
	updateSessionSchema,
} from "../events/event.schema";
import type { AppContext } from "../../types";

type Ctx = Context<AppContext>;

// K-2: baca internal event terbuka lintas divisi untuk published; draft tetap
// milik divisi sendiri. platform_admin (events.*.all) melihat semuanya.
const viewerFrom = (c: Ctx): InternalEventViewer => {
	const permissions = c.get("permissions") ?? [];
	return {
		divisionId: c.get("activeDivisionId"),
		isAll: permissions.includes("events.read.all"),
	};
};

// YYYY-MM bulan berjalan di Asia/Jakarta (en-CA → format YYYY-MM).
const currentMonthWib = () =>
	new Date().toLocaleString("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" });

export const listInternalEvents = async (c: Ctx) => {
	const page = Number(c.req.query("page"));
	const perPage = Number(c.req.query("per_page"));
	const result = await internalEventService.listAdmin(getDb(c.env.DB), viewerFrom(c), {
		page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : undefined,
		perPage: Number.isFinite(perPage) && perPage >= 1 ? Math.floor(perPage) : undefined,
	});
	return ApiResponse.ok(c, "OK", result);
};

export const getInternalEvent = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const result = await internalEventService.getWithSessions(getDb(c.env.DB), id, viewerFrom(c));
	// 404, bukan 403: keberadaan draft divisi lain tidak boleh terungkap.
	if (!result) throw ApiError.notFound("Internal event not found");
	return ApiResponse.ok(c, "OK", result);
};

export const calendarInternalEvents = async (c: Ctx) => {
	const raw = c.req.query("month");
	const month = raw ?? currentMonthWib();
	if (!/^\d{4}-\d{2}$/.test(month)) {
		throw ApiError.validation("Validation failed", {
			month: ["Must be YYYY-MM, e.g. 2026-09"],
		});
	}
	return ApiResponse.ok(c, "OK", await internalEventService.calendar(getDb(c.env.DB), month));
};

export const createInternalEvent = async (c: Ctx) => {
	const input = await parseJson(c, createEventSchema);
	const divisionId = c.get("activeDivisionId");
	const userId = c.get("userId");
	const result = await internalEventService.create(getDb(c.env.DB), input, { divisionId, userId });
	if (result) {
		await recordAuditLog(c, {
			action: "internal_events.create",
			resourceType: "internal_event",
			resourceId: result.id,
			metadata: { title: result.title, slug: result.slug, divisionId },
		});
	}
	return ApiResponse.created(c, "Internal event created", result);
};

export const updateInternalEvent = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const input = await parseJson(c, updateEventSchema);
	const result = await internalEventService.update(getDb(c.env.DB), id, input, c.get("userId"));
	// Jejak audit dicatat untuk SEMUA mutasi, termasuk update sesi — di modul
	// student event lima titik mutasi bolong (D-U). Tidak diulang di sini.
	await recordAuditLog(c, {
		action: "internal_events.update",
		resourceType: "internal_event",
		resourceId: id,
		metadata: { fields: Object.keys(input) },
	});
	return ApiResponse.ok(c, "Internal event updated", result);
};

export const deleteInternalEvent = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const deleted = await internalEventService.delete(getDb(c.env.DB), id);
	await recordAuditLog(c, {
		action: "internal_events.delete",
		resourceType: "internal_event",
		resourceId: id,
		metadata: { title: deleted.title, slug: deleted.slug, divisionId: deleted.divisionId },
	});
	return ApiResponse.ok(c, "Internal event deleted");
};

export const addInternalSession = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const input = await parseJson(c, createSessionSchema);
	const result = await internalEventService.addSession(getDb(c.env.DB), id, input);
	await recordAuditLog(c, {
		action: "internal_events.session_add",
		resourceType: "internal_event",
		resourceId: id,
		metadata: { session_name: input.name },
	});
	return ApiResponse.created(c, "Session added", result);
};

export const updateInternalSession = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const input = await parseJson(c, updateSessionSchema);
	const result = await internalEventService.updateSession(getDb(c.env.DB), id, input);
	await recordAuditLog(c, {
		action: "internal_events.session_update",
		resourceType: "internal_session",
		resourceId: id,
	});
	return ApiResponse.ok(c, "Session updated", result);
};

export const deleteInternalSession = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	await internalEventService.deleteSession(getDb(c.env.DB), id);
	await recordAuditLog(c, {
		action: "internal_events.session_delete",
		resourceType: "internal_session",
		resourceId: id,
	});
	return ApiResponse.ok(c, "Session deleted");
};

export const reorderInternalSessions = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const { session_ids } = await parseJson(c, reorderSessionsSchema);
	const result = await internalEventService.reorderSessions(getDb(c.env.DB), id, session_ids);
	await recordAuditLog(c, {
		action: "internal_events.session_reorder",
		resourceType: "internal_event",
		resourceId: id,
	});
	return ApiResponse.ok(c, "Sessions reordered", result);
};

export const setInternalEventStatus = (status: "draft" | "published") => async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const result = await internalEventService.setStatus(getDb(c.env.DB), id, status);
	await recordAuditLog(c, {
		action: status === "published" ? "internal_events.publish" : "internal_events.unpublish",
		resourceType: "internal_event",
		resourceId: id,
	});
	return ApiResponse.ok(
		c,
		status === "published" ? "Internal event published" : "Internal event unpublished",
		result,
	);
};
