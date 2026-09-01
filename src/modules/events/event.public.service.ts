import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { ApiError } from "../../shared/api-error";
import { eventSessions, events } from "../../db/schema";
import type { Db } from "../../db/connection";
import { computeStatus } from "./status";

// WIB = UTC+7 tanpa DST. Konversi "YYYY-MM" ke rentang epoch ms bulan tsb.
const monthRangeWib = (month: string): { startMs: number; endMs: number } => {
	const m = /^(\d{4})-(\d{2})$/.exec(month);
	if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
		throw ApiError.validation("Validation failed", {
			month: ["Must be in YYYY-MM format, e.g. 2026-09"],
		});
	}
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const nextMonth = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
	return {
		startMs: Date.parse(`${month}-01T00:00:00+07:00`),
		endMs: Date.parse(`${nextMonth}-01T00:00:00+07:00`),
	};
};

const statusFilter = (status: string | undefined, now: number) => {
	if (status === "ongoing")
		return and(lte(events.startsAtMs, now), gte(events.endsAtMs, now));
	if (status === "upcoming") return sql`${events.startsAtMs} > ${now}`;
	if (status === "past") return sql`${events.endsAtMs} < ${now}`;
	return undefined;
};

export const publicEventService = {
	async list(db: Db, opts: { status?: string; limit: number; page: number }) {
		if (opts.status && !["ongoing", "upcoming", "past"].includes(opts.status)) {
			throw ApiError.validation("Validation failed", {
				status: ["Must be one of: ongoing, upcoming, past"],
			});
		}

		const now = Date.now();
		const where = and(eq(events.status, "published"), statusFilter(opts.status, now));

		// Sortir SDD §4.1: ongoing di atas, upcoming terdekat dulu, past terbaru dulu.
		const rows = await db
			.select()
			.from(events)
			.where(where)
			.orderBy(
				sql`CASE
					WHEN ${events.startsAtMs} <= ${now} AND ${events.endsAtMs} >= ${now} THEN 0
					WHEN ${events.startsAtMs} > ${now} THEN 1
					ELSE 2 END`,
				sql`CASE
					WHEN ${events.startsAtMs} > ${now} THEN ${events.startsAtMs}
					ELSE -${events.startsAtMs} END`,
			)
			.limit(opts.limit)
			.offset((opts.page - 1) * opts.limit);

		const [{ count }] = await db
			.select({ count: sql<number>`count(*)` })
			.from(events)
			.where(where);

		return {
			items: rows.map((e) => ({
				...toShape(e),
				status: computeStatus(e.startsAt, e.endsAt, now),
			})),
			meta: { current_page: opts.page, total: count, per_page: opts.limit },
		};
	},

	async getBySlug(db: Db, slug: string) {
		const [ev] = await db
			.select()
			.from(events)
			.where(and(eq(events.slug, slug), eq(events.status, "published")))
			.limit(1);
		if (!ev) throw ApiError.notFound("Event not found");

		const sessions = await db
			.select({
				id: eventSessions.id,
				name: eventSessions.name,
				starts_at: eventSessions.startsAt,
				ends_at: eventSessions.endsAt,
				speaker: eventSessions.speaker,
				location: eventSessions.location,
				description: eventSessions.description,
			})
			.from(eventSessions)
			.where(eq(eventSessions.eventId, ev.id))
			.orderBy(asc(eventSessions.startsAtMs));

		// Status dihitung server — konsisten dengan list (SDD §4.1).
		return { ...toShape(ev), status: computeStatus(ev.startsAt, ev.endsAt, Date.now()), sessions };
	},

	async calendar(db: Db, month: string) {
		const { startMs, endMs } = monthRangeWib(month);
		// Multi-hari tetap masuk: rentang event beririsan dengan bulan.
		const rows = await db
			.select({
				slug: events.slug,
				title: events.title,
				starts_at: events.startsAt,
				ends_at: events.endsAt,
				location: events.location,
				startsAtMs: events.startsAtMs,
				endsAtMs: events.endsAtMs,
			})
			.from(events)
			.where(
				and(
					eq(events.status, "published"),
					lte(events.startsAtMs, endMs - 1),
					gte(events.endsAtMs, startMs),
				),
			)
			.orderBy(asc(events.startsAtMs));

		return { items: rows.map(({ startsAtMs, endsAtMs, ...rest }) => rest) };
	},
};

// Field contract publik (snake_case, tanpa kolom internal ms/slug index duplikat).
const toShape = (e: typeof events.$inferSelect) => ({
	id: e.id,
	slug: e.slug,
	title: e.title,
	description: e.description,
	cover_image_url: e.coverImageUrl,
	starts_at: e.startsAt,
	ends_at: e.endsAt,
	location: e.location,
	location_url: e.locationUrl,
	registration_url: e.registrationUrl,
	registration_open: e.registrationOpen,
	organizer: e.organizer,
});
