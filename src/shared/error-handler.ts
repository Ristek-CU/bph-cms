import type { Context } from "hono";
import { ApiError } from "./api-error";

/**
 * Error handler.
 *
 * Hanya `ApiError` yang pesannya boleh keluar ke klien — itu memang pesan yang
 * kita tulis untuk pengguna. Error lain (D1/Drizzle, JSON parse, TypeError)
 * berisi detail internal: nama tabel/kolom, potongan SQL, constraint yang
 * dilanggar. Detail itu dicatat ke log server, bukan dikirim ke response.
 */
export const errorHandler = (err: unknown, c: Context): Response => {
	const isOperational = err instanceof ApiError;
	const statusCode = isOperational ? err.statusCode : 500;
	const clientMessage = isOperational ? err.message : "Internal server error";
	const errors = isOperational ? err.errors : undefined;
	const requestId = c.get("requestId");

	console.error(
		JSON.stringify({
			timestamp: new Date().toISOString(),
			level: "ERROR",
			requestId,
			statusCode,
			path: c.req.path,
			method: c.req.method,
			// Detail internal hanya di log.
			internalMessage: err instanceof Error ? err.message : String(err),
			...(isOperational && errors !== undefined && { errors }),
		}),
	);

	return new Response(
		JSON.stringify({
			success: false,
			message: clientMessage,
			statusCode,
			...(errors !== undefined && { errors }),
			...(requestId ? { requestId } : {}),
		}),
		{ status: statusCode, headers: { "Content-Type": "application/json" } },
	);
};
