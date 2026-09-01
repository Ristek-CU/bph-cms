import { z } from "zod";

// ISO 8601 dengan offset wajib (SDD A7). Offset asli dipertahankan — tidak
// dinormalkan ke UTC, supaya API balikin persis format contract (mis. +07:00).
const isoDatetime = z
	.string()
	.refine(
		(v) => !Number.isNaN(Date.parse(v)) && /T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(v),
		"Must be ISO 8601 with offset (e.g. 2026-09-10T08:00:00+07:00)",
	);

const urlField = z.url("Must be a valid URL").max(2048);

export const sessionInputSchema = z
	.object({
		name: z.string().trim().min(1).max(200),
		starts_at: isoDatetime,
		ends_at: isoDatetime,
		speaker: z.string().max(200).nullish(),
		location: z.string().max(200).nullish(),
		description: z.string().max(5000).nullish(),
	});
export type SessionInput = z.infer<typeof sessionInputSchema>;

export const createEventSchema = z
	.object({
		slug: z
			.string()
			.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be kebab-case")
			.min(3)
			.max(120)
			.optional(),
		title: z.string().trim().min(1).max(200),
		description: z.string().max(10000).nullish(),
		cover_image_url: urlField.nullish(),
		starts_at: isoDatetime,
		ends_at: isoDatetime,
		location: z.string().trim().min(1).max(300),
		location_url: urlField.nullish(),
		registration_url: urlField.nullish(),
		registration_open: z.boolean().default(true),
		organizer: z.string().max(200).nullish(),
		sessions: z.array(sessionInputSchema).max(100).optional(),
	})
	.refine((v) => Date.parse(v.ends_at) > Date.parse(v.starts_at), {
		message: "ends_at must be after starts_at",
		path: ["ends_at"],
	});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z
	.object({
		title: z.string().trim().min(1).max(200).optional(),
		description: z.string().max(10000).nullish(),
		cover_image_url: urlField.nullish(),
		starts_at: isoDatetime.optional(),
		ends_at: isoDatetime.optional(),
		location: z.string().trim().min(1).max(300).optional(),
		location_url: urlField.nullish(),
		registration_url: urlField.nullish(),
		registration_open: z.boolean().optional(),
		organizer: z.string().max(200).nullish(),
	})
	.refine(
		(v) =>
			!v.starts_at ||
			!v.ends_at ||
			Date.parse(v.ends_at) > Date.parse(v.starts_at),
		{ message: "ends_at must be after starts_at", path: ["ends_at"] },
	);
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const createSessionSchema = sessionInputSchema
	.refine((v) => Date.parse(v.ends_at) > Date.parse(v.starts_at), {
		message: "ends_at must be after starts_at",
		path: ["ends_at"],
	});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

export const updateSessionSchema = z
	.object({
		name: z.string().trim().min(1).max(200).optional(),
		starts_at: isoDatetime.optional(),
		ends_at: isoDatetime.optional(),
		speaker: z.string().max(200).nullish(),
		location: z.string().max(200).nullish(),
		description: z.string().max(5000).nullish(),
	})
	.refine(
		(v) => !v.starts_at || !v.ends_at || Date.parse(v.ends_at) > Date.parse(v.starts_at),
		{ message: "ends_at must be after starts_at", path: ["ends_at"] },
	);

export const reorderSessionsSchema = z.object({
	session_ids: z.array(z.string().min(1)).min(1).max(100),
});

export const idParamSchema = z.object({ id: z.string().min(1) });
