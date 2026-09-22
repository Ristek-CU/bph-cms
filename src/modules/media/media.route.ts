import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { ApiResponse } from "../../shared/api-response";
import { successWrapper, errorWrapper, mediaUploadSchema } from "../openapi/schemas";
import { uuidv7 } from "uuidv7";
import { adminAuth } from "../../middlewares/admin-auth";
import { requirePermission } from "../../middlewares/require-permission";
import { recordAuditLog } from "../audit/audit.service";
import { normalizeStoredExt, readImageUpload } from "./image-upload";
import type { AppContext } from "../../types";

export const mediaRouter = new Hono<AppContext>();

// Upload = operasi admin/divisi dengan permission media.
mediaRouter.use("*", adminAuth, requirePermission("media.upload.own_division"));

mediaRouter.post(
	"/",
	describeRoute({
		summary: "Upload cover image (multipart 'file')",
		description:
			"multipart/form-data field 'file'. JPG/PNG/WebP, maks 5MB. 201 → { url } untuk cover_image_url. Nama file disanitasi (uuidv7).",
		tags: ["Media"],
		security: [{ bearerAuth: [] }],
		responses: {
			201: {
				description: "Uploaded, returns { url }",
				content: { "application/json": { schema: resolver(successWrapper(mediaUploadSchema)) } },
			},
			401: { description: "Unauthorized" },
			422: {
				description: "Validation error (type/size)",
				content: { "application/json": { schema: resolver(errorWrapper) } },
			},
		},
	}),
	async (c) => {
		const { file, ext, mime } = await readImageUpload(c);

		// Key dari uuidv7 + ekstensi valid — tidak ada user input di path (sanitize gratis).
		const key = `covers/${uuidv7()}.${normalizeStoredExt(ext)}`;
		await c.env.BUCKET.put(key, file.stream(), {
			httpMetadata: { contentType: mime },
		});

		await recordAuditLog(c, {
			action: "media.upload",
			resourceType: "media",
			resourceId: key,
			metadata: { contentType: mime, size: file.size },
		});

		return ApiResponse.created(c, "Media uploaded", {
			url: `${c.env.API_BASE_URL}/storage/${key}`,
		});
	},
);
