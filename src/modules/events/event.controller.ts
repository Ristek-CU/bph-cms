import type { Context } from "hono";
import { ApiResponse } from "../../shared/api-response";
import { parseJson, parseParams } from "../../shared/parse-request";
import { getDb } from "../../db/connection";
import { eventService } from "./event.service";
import { recordAuditLog } from "../audit/audit.service";
import {
	createEventSchema,
	createSessionSchema,
	idParamSchema,
	reorderSessionsSchema,
	updateEventSchema,
	updateSessionSchema,
} from "./event.schema";
import type { AppContext } from "../../types";

type Ctx = Context<AppContext>;

export const listEvents = async (c: Ctx) => {
	const permissions = c.get("permissions") ?? [];
	const activeDivisionId = c.get("activeDivisionId");
	const isAll = permissions.includes("events.read.all");
	const result = await eventService.listAdmin(getDb(c.env.DB), {
		divisionId: isAll ? undefined : activeDivisionId,
	});
	return ApiResponse.ok(c, "OK", result);
};

export const createEvent = async (c: Ctx) => {
	const input = await parseJson(c, createEventSchema);
	const divisionId = c.get("activeDivisionId");
	const userId = c.get("userId");
	const result = await eventService.create(getDb(c.env.DB), input, { divisionId, userId });
	if (result) {
		await recordAuditLog(c, {
			action: "events.create",
			resourceType: "event",
			resourceId: result.id,
			metadata: { title: result.title, slug: result.slug, divisionId },
		});
	}
	return ApiResponse.created(c, "Event created", result);
};

export const updateEvent = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const input = await parseJson(c, updateEventSchema);
	const result = await eventService.update(getDb(c.env.DB), id, input);
	await recordAuditLog(c, {
		action: "events.update",
		resourceType: "event",
		resourceId: id,
	});
	return ApiResponse.ok(c, "Event updated", result);
};

export const deleteEvent = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const deleted = await eventService.delete(getDb(c.env.DB), id);
	await recordAuditLog(c, {
		action: "events.delete",
		resourceType: "event",
		resourceId: id,
		metadata: { title: deleted.title, slug: deleted.slug, divisionId: deleted.divisionId },
	});
	return ApiResponse.ok(c, "Event deleted");
};

export const addSession = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const input = await parseJson(c, createSessionSchema);
	const result = await eventService.addSession(getDb(c.env.DB), id, input);
	return ApiResponse.created(c, "Session added", result);
};

export const updateSession = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const input = await parseJson(c, updateSessionSchema);
	const result = await eventService.updateSession(getDb(c.env.DB), id, input);
	return ApiResponse.ok(c, "Session updated", result);
};

export const deleteSession = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	await eventService.deleteSession(getDb(c.env.DB), id);
	await recordAuditLog(c, {
		action: "events.session_delete",
		resourceType: "session",
		resourceId: id,
	});
	return ApiResponse.ok(c, "Session deleted");
};

export const reorderSessions = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const { session_ids } = await parseJson(c, reorderSessionsSchema);
	const result = await eventService.reorderSessions(getDb(c.env.DB), id, session_ids);
	return ApiResponse.ok(c, "Sessions reordered", result);
};
