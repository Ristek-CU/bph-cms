import { STATUS_CODES, type StatusCode } from "./status-codes";
import type { Context } from "hono";

// ponytail: copy of @internal/shared (superapp) — standalone repo can't import workspace pkg.
type ApiResponseParams<T> = {
	success: boolean;
	message: string;
	statusCode: StatusCode;
	data?: T | null;
	errors?: unknown;
};

export class ApiResponse<T = unknown> {
	public readonly success: boolean;
	public readonly message: string;
	public readonly statusCode: StatusCode;
	public readonly data?: T | null;
	public readonly errors?: unknown;

	constructor({ success, message, statusCode, data, errors }: ApiResponseParams<T>) {
		this.success = success;
		this.message = message;
		this.statusCode = statusCode;
		this.data = data;
		this.errors = errors;
	}

	send(_c: any): Response {
		return new Response(
			JSON.stringify({
				success: this.success,
				message: this.message,
				statusCode: this.statusCode,
				...(this.data !== undefined && { data: this.data }),
				...(this.errors !== undefined && { errors: this.errors }),
			}),
			{
				status: this.statusCode,
				headers: { "Content-Type": "application/json" },
			},
		);
	}

	static success<T>(
		c: any,
		message: string,
		data?: T,
		statusCode: StatusCode = STATUS_CODES.OK,
	): Response {
		return new ApiResponse<T>({ success: true, message, data, statusCode }).send(c);
	}

	static ok<T>(c: any, message = "OK", data?: T) {
		return ApiResponse.success(c, message, data, STATUS_CODES.OK);
	}

	static created<T>(c: any, message = "Created", data?: T) {
		return ApiResponse.success(c, message, data, STATUS_CODES.CREATED);
	}
}
