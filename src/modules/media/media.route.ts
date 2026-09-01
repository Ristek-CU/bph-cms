import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ApiError } from "../../shared/api-error";
import { ApiResponse } from "../../shared/api-response";
import { uuidv7 } from "uuidv7";
import { adminAuth } from "../../middlewares/admin-auth";
import { requireRole } from "../../middlewares/require-role";
import type { AppContext } from "../../types";

// SDD §4.4: JPG/PNG/WebP ≤ 5MB.
const ALLOWED_TYPES: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
};
const MAX_SIZE = 5 * 1024 * 1024;

export const mediaRouter = new Hono<AppContext>();

// Upload = operasi admin: wajib session + role admin (SDD §6).
mediaRouter.use("*", adminAuth, requireRole("admin"));

mediaRouter.post(
	"/",
	describeRoute({
		summary: "Upload cover image (multipart 'file')",
		tags: ["Media"],
		security: [{ bearerAuth: [] }],
		responses: {
			201: { description: "Uploaded, returns { url }" },
			401: { description: "Unauthorized" },
			422: { description: "Validation error (type/size)" },
		},
	}),
	async (c) => {
	const form = await c.req.formData().catch(() => null);
	const file = form?.get("file");
	if (!(file instanceof File)) {
		throw ApiError.validation("Validation failed", {
			file: ["Multipart field 'file' is required"],
		});
	}

	const ext = ALLOWED_TYPES[file.type as keyof typeof ALLOWED_TYPES];
	if (!ext) {
		throw ApiError.validation("Validation failed", {
			file: ["Must be JPG, PNG, or WebP"],
		});
	}
	if (file.size > MAX_SIZE) {
		throw ApiError.validation("Validation failed", {
			file: ["Max size is 5MB"],
		});
	}

	// Key dari uuidv7 + ekstensi valid — tidak ada user input di path (sanitize gratis).
	const key = `covers/${uuidv7()}.${ext}`;
	await c.env.BUCKET.put(key, file.stream(), {
		httpMetadata: { contentType: file.type },
	});

	return ApiResponse.created(c, "Media uploaded", {
		url: `${c.env.API_BASE_URL}/storage/${key}`,
	});
});
