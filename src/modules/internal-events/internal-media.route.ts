import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { ApiError } from "../../shared/api-error";
import { ApiResponse } from "../../shared/api-response";
import { successWrapper, errorWrapper, mediaUploadSchema } from "../openapi/schemas";
import { uuidv7 } from "uuidv7";
import { adminAuth } from "../../middlewares/admin-auth";
import { requirePermission } from "../../middlewares/require-permission";
import { recordAuditLog } from "../audit/audit.service";
import { normalizeStoredExt, readImageUpload } from "../media/image-upload";
import type { AppContext } from "../../types";

// Media internal event (K-6).
//
// Cover student event masuk prefix `covers/` dan dilayani PUBLIK tanpa auth di
// /api/v1/storage/covers/* — wajar, karena event itu memang untuk mahasiswa.
// Internal event tidak: agenda internal tidak boleh bisa diambil siapa pun yang
// kebetulan punya URL-nya. Karena itu prefix-nya dipisah dan servisnya
// di belakang adminAuth.
//
// Konsekuensi yang harus disadari panel: <img src> tidak mengirim header
// Authorization, jadi cover internal diambil lewat fetch ber-token lalu
// dirender sebagai object URL (panel/src/components/AuthImage.jsx).

export const INTERNAL_COVER_PREFIX = "internal-covers/";

// Persis bentuk yang dihasilkan upload di bawah: uuidv7 + ekstensi whitelist.
// Regex ini yang mencegah path traversal — nama file tidak pernah dipakai
// apa adanya sebagai key R2 sebelum cocok.
const STORED_FILE_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

export const internalMediaRouter = new Hono<AppContext>();

internalMediaRouter.post(
	"/",
	adminAuth,
	requirePermission("media.upload.own_division"),
	describeRoute({
		summary: "Upload cover internal event (multipart 'file')",
		description:
			"multipart/form-data field 'file'. JPG/PNG/WebP, maks 5MB — aturan identik /admin/media. 201 → { url } untuk cover_image_url. Bedanya: objek masuk prefix internal-covers/ dan URL-nya HANYA bisa dibaca dengan Bearer token.",
		tags: ["Media"],
		security: [{ bearerAuth: [] }],
		responses: {
			201: {
				description: "Uploaded, returns { url }",
				content: { "application/json": { schema: resolver(successWrapper(mediaUploadSchema)) } },
			},
			401: { description: "Unauthorized" },
			403: { description: "Forbidden (insufficient role)" },
			422: {
				description: "Validation error (type/size)",
				content: { "application/json": { schema: resolver(errorWrapper) } },
			},
		},
	}),
	async (c) => {
		const { file, ext, mime } = await readImageUpload(c);

		const filename = `${uuidv7()}.${normalizeStoredExt(ext)}`;
		const key = `${INTERNAL_COVER_PREFIX}${filename}`;
		await c.env.BUCKET.put(key, file.stream(), {
			httpMetadata: { contentType: mime },
		});

		await recordAuditLog(c, {
			action: "internal_media.upload",
			resourceType: "internal_media",
			resourceId: key,
			metadata: { contentType: mime, size: file.size },
		});

		return ApiResponse.created(c, "Media uploaded", {
			url: `${c.env.API_BASE_URL}/admin/internal-media/${filename}`,
		});
	},
);

internalMediaRouter.get(
	"/:filename",
	adminAuth,
	// events.read, bukan media.upload: semua pengurus boleh melihat internal
	// event (K-2), jadi semua pengurus boleh melihat cover-nya. Viewer tidak
	// punya media.upload dan tetap harus bisa melihat gambar.
	requirePermission("events.read.own_division"),
	describeRoute({
		summary: "Serve internal event cover (Bearer required)",
		description:
			"Membaca objek di prefix internal-covers/. Wajib Authorization: Bearer — tidak seperti /storage/covers/* yang publik. Nama file harus uuidv7 + ekstensi whitelist; selain itu 404.",
		tags: ["Media"],
		security: [{ bearerAuth: [] }],
		responses: {
			200: { description: "Image bytes", content: { "image/*": {} } },
			401: { description: "Unauthorized" },
			403: { description: "Forbidden (insufficient role)" },
			404: { description: "Not found or invalid filename" },
		},
	}),
	async (c) => {
		const filename = c.req.param("filename");
		if (!STORED_FILE_RE.test(filename)) {
			// 404, bukan 422: endpoint ini mengambil gambar, dan pemanggil yang
			// salah key tidak perlu diberi tahu bentuk key yang benar.
			throw ApiError.notFound("Media tidak ditemukan");
		}

		const object = await c.env.BUCKET.get(`${INTERNAL_COVER_PREFIX}${filename}`);
		if (!object) throw ApiError.notFound("Media tidak ditemukan");

		return new Response(object.body, {
			headers: {
				"Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
				// private — key uuid unik per objek jadi immutable aman, tetapi
				// 'public' akan membolehkan shared cache menyimpan gambar
				// ber-auth. Beda disengaja dari /storage/covers/*.
				"Cache-Control": "private, max-age=31536000, immutable",
			},
		});
	},
);
