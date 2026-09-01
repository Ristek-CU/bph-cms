import type { Context } from "hono";
import { ApiError } from "./api-error";

export const errorHandler = (err: unknown, c: Context): Response => {
	let statusCode = 500;
	let message = "Internal server error";
	let errors: unknown;
	let stack: string | undefined;

	if (err instanceof ApiError) {
		statusCode = err.statusCode;
		message = err.message;
		errors = err.errors;
		stack = err.stack;
	} else if (err instanceof Error) {
		message = err.message;
		stack = err.stack;
	}

	console.error(
		JSON.stringify({
			timestamp: new Date().toISOString(),
			level: "ERROR",
			message,
			statusCode,
			path: c.req.path,
			method: c.req.method,
			...(errors !== undefined && { errors }),
		}),
	);

	return new Response(
		JSON.stringify({
			success: false,
			message,
			statusCode,
			...(errors !== undefined && { errors }),
		}),
		{ status: statusCode, headers: { "Content-Type": "application/json" } },
	);
};
