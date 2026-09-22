import type { Context } from "hono";
import { ApiError } from "../../shared/api-error";
import type { AppContext } from "../../types";

// Validasi unggahan gambar, dipakai bersama oleh media publik (`covers/`) dan
// media internal event (`internal-covers/`, K-6). Sengaja satu sumber: ini
// kode keamanan, dan dua salinan berarti dua tempat yang bisa tertinggal saat
// aturannya diperketat.
//
// SDD §4.4: JPG/PNG/WebP ≤ 5MB. Ekstensi diekstrak dari nama file — Content-Type
// klien tidak dipercaya (pola form.public.route: "x.jpg" bisa dikirim sebagai
// text/html). Mime R2 selalu diturunkan dari ekstensi.
const EXT_MIME: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
};

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

// Magic bytes — ekstensi bisa dibohongi (HTML di-rename .png). Content-Type
// diserve dari whitelist + nosniff sudah menutup eksekusi, ini lapis kedua
// supaya file nggak-gambar tidak pernah tersimpan.
const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
	"image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	"image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
	"image/webp": (b) =>
		b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x50,
};

export type ValidatedImage = { file: File; ext: string; mime: string };

/**
 * Baca field multipart `file` dan pastikan isinya benar-benar gambar dari
 * whitelist. Melempar 422 dengan kontrak `errors: { file: [msg] }`.
 */
export const readImageUpload = async (c: Context<AppContext>): Promise<ValidatedImage> => {
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
	if (file.size > MAX_IMAGE_SIZE) {
		throw ApiError.validation("Validation failed", {
			file: ["Max size is 5MB"],
		});
	}

	const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
	const matchesMagic = MAGIC[mime];
	if (matchesMagic && !matchesMagic(head)) {
		throw ApiError.validation("Validation failed", {
			file: ["File bukan gambar yang valid (rusak atau menyamar)."],
		});
	}

	return { file, ext, mime };
};

/** Nama file R2 hasil upload: uuidv7 + ekstensi valid, tanpa user input. */
export const normalizeStoredExt = (ext: string) => (ext === "jpeg" ? "jpg" : ext);
