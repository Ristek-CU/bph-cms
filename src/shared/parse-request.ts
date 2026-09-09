import type { Context } from "hono";
import { z } from "zod";
import { ApiError } from "./api-error";
import type { AppContext } from "../types";

type Ctx = Context<AppContext>;

/**
 * Parse & validate JSON body — 400 untuk JSON rusak, 422 dengan
 * `errors: { field: [msg] }` untuk payload yang tidak lolos schema.
 *
 * Tanpa ini, `c.req.json()` yang gagal melempar SyntaxError dan klien menerima
 * 500 berisi pesan parser internal.
 */
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
