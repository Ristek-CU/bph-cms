import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { ApiError } from "../../shared/api-error";
import { ApiResponse } from "../../shared/api-response";
import { successWrapper, errorWrapper, mediaUploadSchema } from "../openapi/schemas";
import { uuidv7 } from "uuidv7";
import { adminAuth } from "../../middlewares/admin-auth";
import { requirePermission } from "../../middlewares/require-permission";
import { recordAuditLog } from "../audit/audit.service";
import type { AppContext } from "../../types";

// SDD §4.4: JPG/PNG/WebP ≤ 5MB. Ekstensi diekstrak dari nama file — Content-Type
// klien tidak dipercaya (pola form.public.route: "x.jpg" bisa dikirim sebagai
// text/html). Mime R2 selalu diturunkan dari ekstensi.
const EXT_MIME: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
};
const MAX_SIZE = 5 * 1024 * 1024;

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
	const form = await c.req.formData().catch(() => null);
	const file = form?.get("file");
	if (!(file instanceof File)) {
		throw ApiError.validation("Validation failed", {
			file: ["Multipart field 'file' is required"],
		});
	}

	const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
	const mime = EXT_MIME[ext];
	if (!mime) {
		throw ApiError.validation("Validation failed", {
			file: ["Must be JPG, PNG, or WebP"],
		});
	}
	if (file.size > MAX_SIZE) {
		throw ApiError.validation("Validation failed", {
			file: ["Max size is 5MB"],
		});
	}

	// Magic bytes — ekstensi bisa dibohongi (HTML di-rename .png). Content-Type
	// diserve dari whitelist + nosniff sudah menutup eksekusi, ini lapis kedua
	// supaya file nggak-gambar tidak pernah tersimpan.
	const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
	const matchesMagic: Record<string, (b: Uint8Array) => boolean> = {
		"image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
		"image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
		"image/webp": (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x50,
	};
	const matchFn = matchesMagic[mime];
	if (matchFn && !matchFn(head)) {
		throw ApiError.validation("Validation failed", {
			file: ["File bukan gambar yang valid (rusak atau menyamar)."],
		});
	}

	// Key dari uuidv7 + ekstensi valid — tidak ada user input di path (sanitize gratis).
	const key = `covers/${uuidv7()}.${ext === "jpeg" ? "jpg" : ext}`;
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
});
