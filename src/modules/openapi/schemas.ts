import { z } from "zod";

// Wrapper response (kontrak ekosistem) — dipakai semua describeRoute.
export const successWrapper = <T extends z.ZodTypeAny>(data: T) =>
	z.object({
		success: z.literal(true),
		message: z.string(),
		statusCode: z.number(),
		data,
	});

export const errorWrapper = z.object({
	success: z.literal(false),
	message: z.string(),
	statusCode: z.number(),
	errors: z.record(z.string(), z.array(z.string())).optional(),
});

// ---- Event & Sesi (contract SDD §4 — snake_case di API) ----

export const sessionSchema = z.object({
	id: z.string().describe("UUIDv7 sesi"),
	name: z.string(),
	starts_at: z.string().describe("ISO 8601 + offset, tampilan WIB"),
	ends_at: z.string(),
	speaker: z.string().nullable(),
	location: z.string().nullable(),
	description: z.string().nullable(),
});

export const eventListItemSchema = z.object({
	id: z.string(),
	slug: z.string(),
	title: z.string(),
	description: z.string().nullable(),
	cover_image_url: z.string().nullable(),
	starts_at: z.string(),
	ends_at: z.string(),
	location: z.string(),
	location_url: z.string().nullable(),
	registration_url: z.string().nullable(),
	registration_open: z.boolean(),
	organizer: z.string().nullable(),
	status: z.enum(["ongoing", "upcoming", "past"]),
});

export const eventDetailSchema = eventListItemSchema.extend({
	sessions: z.array(sessionSchema),
});

export const calendarItemSchema = z.object({
	slug: z.string(),
	title: z.string(),
	starts_at: z.string(),
	ends_at: z.string(),
	location: z.string(),
});

export const adminSessionSchema = z.object({
	id: z.string(),
	name: z.string(),
	starts_at: z.string(),
	ends_at: z.string(),
	speaker: z.string().nullable(),
	location: z.string().nullable(),
	description: z.string().nullable(),
	sort_order: z.number().optional(),
});

export const adminEventSchema = z.object({
	id: z.string(),
	slug: z.string(),
	title: z.string(),
	description: z.string().nullable(),
	cover_image_url: z.string().nullable(),
	starts_at: z.string(),
	ends_at: z.string(),
	location: z.string(),
	location_url: z.string().nullable(),
	registration_url: z.string().nullable(),
	registration_open: z.boolean(),
	organizer: z.string().nullable(),
	status: z.enum(["draft", "published"]),
	sessions: z.array(adminSessionSchema),
});

export const mediaUploadSchema = z.object({
	url: z.string().url().describe("Simpan ke cover_image_url"),
});

export const authDataSchema = z.object({
	token: z.string().describe("Bearer token untuk endpoint admin"),
	user: z.object({
		id: z.string(),
		name: z.string(),
		email: z.string(),
		role: z.string(),
	}),
});

// ---- Request body (input) ----

const urlField = z.string().url().max(2048);

export const sessionBodySchema = z.object({
	name: z.string().min(1).max(200),
	starts_at: z.string().describe("ISO 8601 + offset, mis. 2026-09-10T13:00:00+07:00"),
	ends_at: z.string().describe("ISO 8601 + offset"),
	speaker: z.string().max(200).nullish(),
	location: z.string().max(200).nullable(),
	description: z.string().max(5000).nullable(),
});

export const createSessionBodySchema = sessionBodySchema;

export const createEventBodySchema = z.object({
	slug: z
		.string()
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case")
		.min(3)
		.max(120)
		.optional()
		.describe("Kosongkan = auto dari judul"),
	title: z.string().min(1).max(200),
	description: z.string().max(10000).nullable().optional(),
	cover_image_url: urlField.nullable().optional(),
	starts_at: z.string().describe("ISO 8601 + offset"),
	ends_at: z.string(),
	location: z.string().min(1).max(300),
	location_url: urlField.nullable().optional(),
	registration_url: urlField.nullable().optional(),
	registration_open: z.boolean().optional(),
	organizer: z.string().max(200).nullable().optional(),
	sessions: z.array(sessionBodySchema).max(100).optional(),
});

export const updateEventBody = z.object({
	title: z.string().min(1).max(200).optional(),
	description: z.string().max(10000).nullable().optional(),
	cover_image_url: urlField.nullable().optional(),
	starts_at: z.string().optional(),
	ends_at: z.string().optional(),
	location: z.string().min(1).max(300).optional(),
	location_url: urlField.nullable().optional(),
	registration_url: urlField.nullable().optional(),
	registration_open: z.boolean().optional(),
	organizer: z.string().max(200).nullable().optional(),
});

export const updateSessionBody = z.object({
	name: z.string().min(1).max(200).optional(),
	starts_at: z.string().optional(),
	ends_at: z.string().optional(),
	speaker: z.string().max(200).nullable().optional(),
	location: z.string().max(200).nullable().optional(),
	description: z.string().max(5000).nullable().optional(),
});

export const reorderBody = z.object({
	session_ids: z.array(z.string()).min(1).max(100).describe("Urutan baru, array id sesi"),
});

export const signInBody = z.object({
	email: z.string().email(),
	password: z.string().min(8),
});

