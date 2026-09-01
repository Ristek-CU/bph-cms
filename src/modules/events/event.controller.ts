import type { Context } from "hono";
import { z } from "zod";
import { ApiResponse } from "../../shared/api-response";
import { ApiError } from "../../shared/api-error";
import { getDb } from "../../db/connection";
import { eventService } from "./event.service";
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

// Parse & validate JSON body — lempar 422 dengan errors: { field: [msg] }.
export const parseJson = async <S extends z.ZodType>(c: Ctx, schema: S): Promise<z.infer<S>> => {
	let raw: unknown;
	try {
		raw = await c.req.json();
	} catch {
		throw ApiError.badRequest("Invalid JSON body");
	}
	const result = schema.safeParse(raw);
	if (!result.success) {
		throw ApiError.validation(
			"Validation failed",
			z.flattenError(result.error as z.ZodError).fieldErrors as Record<string, string[]>,
		);
	}
	return result.data;
};

export const parseParams = <S extends z.ZodType>(c: Ctx, schema: S): z.infer<S> => {
	const result = schema.safeParse(c.req.param());
	if (!result.success) throw ApiError.badRequest("Invalid parameters");
	return result.data;
};

export const createEvent = async (c: Ctx) => {
	const input = await parseJson(c, createEventSchema);
	const result = await eventService.create(getDb(c.env.DB), input);
	return ApiResponse.created(c, "Event created", result);
};

export const updateEvent = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const input = await parseJson(c, updateEventSchema);
	const result = await eventService.update(getDb(c.env.DB), id, input);
	return ApiResponse.ok(c, "Event updated", result);
};

export const deleteEvent = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	await eventService.delete(getDb(c.env.DB), id);
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
	return ApiResponse.ok(c, "Session deleted");
};

export const reorderSessions = async (c: Ctx) => {
	const { id } = parseParams(c, idParamSchema);
	const { session_ids } = await parseJson(c, reorderSessionsSchema);
	const result = await eventService.reorderSessions(getDb(c.env.DB), id, session_ids);
	return ApiResponse.ok(c, "Sessions reordered", result);
};
