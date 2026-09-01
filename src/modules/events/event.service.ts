import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import { ApiError } from "../../shared/api-error";
import { eventSessions, events } from "../../db/schema";
import type { Db } from "../../db/connection";
import type {
	CreateEventInput,
	CreateSessionInput,
	SessionInput,
	UpdateEventInput,
	UpdateSessionInput,
} from "./event.schema";

const slugify = (title: string) =>
	title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/[\s_]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 120) || "event";

export { slugify };

// ponytail: suffix -2..-N on collision; fine at CMS scale, random suffix if collisions get common.
const uniqueSlug = async (db: Db, base: string): Promise<string> => {
	const rows = await db
		.select({ slug: events.slug })
		.from(events)
		.where(sql`${events.slug} = ${base} OR ${events.slug} LIKE ${base + "-%"}`);
	const taken = new Set(rows.map((r) => r.slug));
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
};

export type EventRow = typeof events.$inferSelect;
export type SessionRow = typeof eventSessions.$inferSelect;

type SessionValidation = { startsAt: string; endsAt: string };

// Sesi tidak boleh di luar rentang event (SDD §4.4). Return map field -> pesan.
const validateSessionsInRange = (
	eventStart: string,
	eventEnd: string,
	sessions: SessionValidation[],
): Record<string, string[]> => {
	const errors: Record<string, string[]> = {};
	const eStart = Date.parse(eventStart);
	const eEnd = Date.parse(eventEnd);
	sessions.forEach((s, i) => {
		if (Date.parse(s.startsAt) < eStart || Date.parse(s.endsAt) > eEnd) {
			errors[`sessions.${i}`] = ["Session must be within the event time range"];
		}
	});
	return errors;
};

const toEpochMs = (iso: string) => Date.parse(iso);

// Normalisasi input zod (starts_at/ends_at) ke bentuk validasi.
const asValidation = (s: Array<{ starts_at: string; ends_at: string }>) =>
	s.map((x) => ({ startsAt: x.starts_at, endsAt: x.ends_at }));

export const eventService = {
	async create(db: Db, input: CreateEventInput) {
		const slug = input.slug
			? (await eventService.assertSlugFree(db, input.slug), input.slug)
			: await uniqueSlug(db, slugify(input.title));

		const sessionErrors = input.sessions
			? validateSessionsInRange(input.starts_at, input.ends_at, asValidation(input.sessions))
			: {};
		if (Object.keys(sessionErrors).length > 0) {
			throw ApiError.validation("Validation failed", sessionErrors);
		}

		const now = new Date().toISOString();
		const [row] = await db
			.insert(events)
			.values({
				id: uuidv7(),
				slug,
				title: input.title,
				description: input.description ?? null,
				coverImageUrl: input.cover_image_url ?? null,
				startsAt: input.starts_at,
				endsAt: input.ends_at,
				startsAtMs: toEpochMs(input.starts_at),
				endsAtMs: toEpochMs(input.ends_at),
				location: input.location,
				locationUrl: input.location_url ?? null,
				registrationUrl: input.registration_url ?? null,
				registrationOpen: input.registration_open,
				organizer: input.organizer ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		if (input.sessions?.length) {
			await this.insertSessions(db, row.id, input.sessions);
		}

		return this.getWithSessions(db, row.id);
	},

	async insertSessions(db: Db, eventId: string, sessions: SessionInput[]) {
		const [ev] = await db
			.select({ startsAtMs: events.startsAtMs, endsAtMs: events.endsAtMs })
			.from(events)
			.where(eq(events.id, eventId))
			.limit(1);

		const errors = validateSessionsInRange(
			new Date(ev.startsAtMs).toISOString(),
			new Date(ev.endsAtMs).toISOString(),
			asValidation(sessions),
		);
		if (Object.keys(errors).length > 0) {
			throw ApiError.validation("Validation failed", errors);
		}

		const maxSort = await db
			.select({ max: sql<number>`coalesce(max(${eventSessions.sortOrder}), -1)` })
			.from(eventSessions)
			.where(eq(eventSessions.eventId, eventId));

		await db.insert(eventSessions).values(
			sessions.map((s, i) => ({
				id: uuidv7(),
				eventId,
				name: s.name,
				startsAt: s.starts_at,
				endsAt: s.ends_at,
				startsAtMs: toEpochMs(s.starts_at),
				endsAtMs: toEpochMs(s.ends_at),
				speaker: s.speaker ?? null,
				location: s.location ?? null,
				description: s.description ?? null,
				sortOrder: (maxSort[0]?.max ?? -1) + 1 + i,
			})),
		);
	},

	async getWithSessions(db: Db, id: string) {
		const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
		if (!event) return null;
		const sessions = await db
			.select()
			.from(eventSessions)
			.where(eq(eventSessions.eventId, id))
			.orderBy(asc(eventSessions.sortOrder), asc(eventSessions.startsAtMs));
		return { ...event, sessions };
	},

	async update(db: Db, id: string, input: UpdateEventInput) {
		const ev = await this.getEventOr404(db, id);

		const startsAt = input.starts_at ?? ev.startsAt;
		const endsAt = input.ends_at ?? ev.endsAt;

		// Rentang baru harus tetap menampung semua sesi lama.
		if (input.starts_at || input.ends_at) {
			const sessions = await db
				.select({ starts_at: eventSessions.startsAt, ends_at: eventSessions.endsAt })
				.from(eventSessions)
				.where(eq(eventSessions.eventId, id));
			const errors = validateSessionsInRange(
				startsAt,
				endsAt,
				sessions.map((s) => ({ startsAt: s.starts_at, endsAt: s.ends_at })),
			);
			if (Object.keys(errors).length > 0) {
				throw ApiError.validation(
					"Event range does not cover existing sessions",
					errors,
				);
			}
		}

		await db
			.update(events)
			.set({
				...(input.title !== undefined && { title: input.title }),
				...(input.description !== undefined && { description: input.description ?? null }),
				...(input.cover_image_url !== undefined && { coverImageUrl: input.cover_image_url ?? null }),
				...(input.starts_at !== undefined && {
					startsAt: input.starts_at,
					startsAtMs: toEpochMs(input.starts_at),
				}),
				...(input.ends_at !== undefined && {
					endsAt: input.ends_at,
					endsAtMs: toEpochMs(input.ends_at),
				}),
				...(input.location !== undefined && { location: input.location }),
				...(input.location_url !== undefined && { locationUrl: input.location_url ?? null }),
				...(input.registration_url !== undefined && { registrationUrl: input.registration_url ?? null }),
				...(input.registration_open !== undefined && { registrationOpen: input.registration_open }),
				...(input.organizer !== undefined && { organizer: input.organizer ?? null }),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(events.id, id));

		return this.getWithSessions(db, id);
	},

	async delete(db: Db, id: string) {
		const result = await db.delete(events).where(eq(events.id, id)).returning();
		if (!result.length) throw ApiError.notFound("Event not found");
	},

	async addSession(db: Db, eventId: string, input: CreateSessionInput) {
		const ev = await this.getEventOr404(db, eventId);
		await this.insertSessions(db, ev.id, [input]);
		return this.getWithSessions(db, ev.id);
	},

	async updateSession(db: Db, sessionId: string, input: UpdateSessionInput) {
		const [existing] = await db
			.select()
			.from(eventSessions)
			.where(eq(eventSessions.id, sessionId))
			.limit(1);
		if (!existing) throw ApiError.notFound("Session not found");

		const [ev] = await db
			.select()
			.from(events)
			.where(eq(events.id, existing.eventId))
			.limit(1);

		const startsAt = input.starts_at ?? existing.startsAt;
		const endsAt = input.ends_at ?? existing.endsAt;

		const errors: Record<string, string[]> = {};
		if (Date.parse(endsAt) <= Date.parse(startsAt)) {
			errors.ends_at = ["ends_at must be after starts_at"];
		}
		if (ev) {
			Object.assign(
				errors,
				validateSessionsInRange(ev.startsAt, ev.endsAt, [{ startsAt, endsAt }]),
			);
		}
		if (Object.keys(errors).length > 0) {
			throw ApiError.validation("Validation failed", errors);
		}

		await db
			.update(eventSessions)
			.set({
				...(input.name !== undefined && { name: input.name }),
				...(input.starts_at !== undefined && {
					startsAt: input.starts_at,
					startsAtMs: toEpochMs(input.starts_at),
				}),
				...(input.ends_at !== undefined && {
					endsAt: input.ends_at,
					endsAtMs: toEpochMs(input.ends_at),
				}),
				...(input.speaker !== undefined && { speaker: input.speaker ?? null }),
				...(input.location !== undefined && { location: input.location ?? null }),
				...(input.description !== undefined && { description: input.description ?? null }),
			})
			.where(eq(eventSessions.id, sessionId));

		return this.getWithSessions(db, existing.eventId);
	},

	async deleteSession(db: Db, sessionId: string) {
		const result = await db
			.delete(eventSessions)
			.where(eq(eventSessions.id, sessionId))
			.returning();
		if (!result.length) throw ApiError.notFound("Session not found");
	},

	async reorderSessions(db: Db, eventId: string, sessionIds: string[]) {
		await this.getEventOr404(db, eventId);

		const rows = await db
			.select({ id: eventSessions.id })
			.from(eventSessions)
			.where(
				and(eq(eventSessions.eventId, eventId), inArray(eventSessions.id, sessionIds)),
			);

		if (rows.length !== sessionIds.length) {
			throw ApiError.validation("Validation failed", {
				session_ids: ["Some session ids do not belong to this event"],
			});
		}

		// ponytail: sequential updates instead of CASE bulk — session counts are ≤ 100.
		for (const [i, sid] of sessionIds.entries()) {
			await db
				.update(eventSessions)
				.set({ sortOrder: i })
				.where(eq(eventSessions.id, sid));
		}

		return this.getWithSessions(db, eventId);
	},

	async getEventOr404(db: Db, id: string): Promise<EventRow> {
		const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
		if (!row) throw ApiError.notFound("Event not found");
		return row;
	},

	async assertSlugFree(db: Db, slug: string, exceptId?: string) {
		const [row] = await db
			.select({ id: events.id })
			.from(events)
			.where(eq(events.slug, slug))
			.limit(1);
		if (row && row.id !== exceptId) {
			throw ApiError.conflict("Slug already exists");
		}
	},
};
