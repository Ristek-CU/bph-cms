import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { ApiError } from "../../shared/api-error";
import { divisions, internalEventSessions, internalEvents } from "../../db/schema";
import type { Db } from "../../db/connection";
import { slugify } from "../events/event.service";
import type {
	CreateEventInput,
	CreateSessionInput,
	SessionInput,
	UpdateEventInput,
	UpdateSessionInput,
} from "../events/event.schema";

// Skema input internal event = skema student event apa adanya (diimpor route &
// controller dari ../events/event.schema). Paritas dijaga lewat reuse, bukan
// copy, supaya "100% mirip" tidak drift saat salah satu diperbaiki.

/**
 * Siapa yang membaca, dipakai memutuskan visibilitas.
 *
 * Aturan K-2: internal event `published` terbaca SEMUA pengurus lintas divisi;
 * `draft` tetap privat milik divisi pemilik (platform_admin melihat semuanya).
 */
export type InternalEventViewer = {
	divisionId?: string;
	isAll: boolean;
};

const visibleTo = (row: { status: string; divisionId: string }, viewer: InternalEventViewer) =>
	row.status === "published" || viewer.isAll || row.divisionId === viewer.divisionId;

// Sufiks -2..-N saat slug bentrok. Lokal karena uniqueSlug di event.service
// terikat tabel `events` — uniqueness internal event berlaku di tabelnya sendiri.
const uniqueSlug = async (db: Db, base: string): Promise<string> => {
	const rows = await db
		.select({ slug: internalEvents.slug })
		.from(internalEvents)
		// substr, bukan LIKE — D1 menolak LIKE pattern >±48 char
		// ("LIKE or GLOB pattern too complex"). Alasan sama dengan event.service.
		.where(
			sql`${internalEvents.slug} = ${base} OR (length(${internalEvents.slug}) > ${base.length} AND substr(${internalEvents.slug}, 1, ${base.length + 1}) = ${base + "-"})`,
		);
	const taken = new Set(rows.map((r) => r.slug));
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
};

export type InternalEventRow = typeof internalEvents.$inferSelect;
export type InternalSessionRow = typeof internalEventSessions.$inferSelect;

type SessionValidation = { startsAt: string; endsAt: string };

const toAdminSessionShape = (s: InternalSessionRow) => ({
	id: s.id,
	name: s.name,
	starts_at: s.startsAt,
	ends_at: s.endsAt,
	speaker: s.speaker,
	location: s.location,
	description: s.description,
	sort_order: s.sortOrder,
});

// division_id/division_name ikut dikirim: panel membutuhkannya untuk badge divisi
// dan untuk memutuskan apakah tombol tulis boleh muncul (K-2 baca lintas divisi,
// tulis hanya divisi sendiri).
const toAdminShape = (
	e: InternalEventRow,
	sessions: InternalSessionRow[] = [],
	divisionName: string | null = null,
) => ({
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
	status: e.status,
	division_id: e.divisionId,
	division_name: divisionName,
	sessions: sessions.map(toAdminSessionShape),
});

// Sesi tidak boleh keluar rentang event (SDD §4.4) — aturan identik student event.
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

const asValidation = (s: Array<{ starts_at: string; ends_at: string }>) =>
	s.map((x) => ({ startsAt: x.starts_at, endsAt: x.ends_at }));

// WIB = UTC+7 tanpa DST. Rentang epoch ms untuk bulan "YYYY-MM".
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

export const internalEventService = {
	async create(
		db: Db,
		input: CreateEventInput,
		meta: { divisionId?: string; userId?: string },
	) {
		// division_id NOT NULL di skema — tanpa divisi pemilik baris tidak bisa
		// ada. requirePermission(".all") tidak menjamin activeDivisionId terisi,
		// jadi diperiksa eksplisit di sini.
		if (!meta.divisionId) {
			throw ApiError.forbidden("Forbidden: akun ini tidak punya divisi aktif");
		}

		const slug = input.slug
			? (await this.assertSlugFree(db, input.slug), input.slug)
			: await uniqueSlug(db, slugify(input.title));

		if (input.sessions) {
			const errors = validateSessionsInRange(
				input.starts_at,
				input.ends_at,
				asValidation(input.sessions),
			);
			if (Object.keys(errors).length > 0) {
				throw ApiError.validation("Validation failed", errors);
			}
		}

		const now = new Date().toISOString();
		const [row] = await db
			.insert(internalEvents)
			.values({
				id: uuidv7(),
				slug,
				// Selalu draft — terbit hanya lewat endpoint publish eksplisit.
				// input.status sengaja diabaikan (perilaku sama dengan eventService).
				status: "draft",
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
				divisionId: meta.divisionId,
				createdByUserId: meta.userId ?? null,
				updatedByUserId: meta.userId ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		if (input.sessions?.length) {
			await this.insertSessions(db, row.id, input.sessions);
		}

		return this.getWithSessions(db, row.id, { divisionId: meta.divisionId, isAll: true });
	},

	async insertSessions(db: Db, eventId: string, sessions: SessionInput[]) {
		const [ev] = await db
			.select({ startsAtMs: internalEvents.startsAtMs, endsAtMs: internalEvents.endsAtMs })
			.from(internalEvents)
			.where(eq(internalEvents.id, eventId))
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
			.select({ max: sql<number>`coalesce(max(${internalEventSessions.sortOrder}), -1)` })
			.from(internalEventSessions)
			.where(eq(internalEventSessions.internalEventId, eventId));

		await db.insert(internalEventSessions).values(
			sessions.map((s, i) => ({
				id: uuidv7(),
				internalEventId: eventId,
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

	/**
	 * Detail + runsheet. Mengembalikan null bila tidak terlihat oleh viewer —
	 * controller menerjemahkannya jadi 404, bukan 403, supaya keberadaan draft
	 * divisi lain tidak bocor.
	 */
	async getWithSessions(db: Db, id: string, viewer: InternalEventViewer) {
		const [row] = await db
			.select({ event: internalEvents, divisionName: divisions.name })
			.from(internalEvents)
			.leftJoin(divisions, eq(internalEvents.divisionId, divisions.id))
			.where(eq(internalEvents.id, id))
			.limit(1);
		if (!row) return null;
		if (!visibleTo(row.event, viewer)) return null;

		const sessions = await db
			.select()
			.from(internalEventSessions)
			.where(eq(internalEventSessions.internalEventId, id))
			.orderBy(asc(internalEventSessions.sortOrder), asc(internalEventSessions.startsAtMs));

		return toAdminShape(row.event, sessions, row.divisionName);
	},

	async update(db: Db, id: string, input: UpdateEventInput, userId?: string) {
		const ev = await this.getOr404(db, id);

		const startsAt = input.starts_at ?? ev.startsAt;
		const endsAt = input.ends_at ?? ev.endsAt;

		if (input.sessions !== undefined) {
			const errors = validateSessionsInRange(startsAt, endsAt, asValidation(input.sessions));
			if (Object.keys(errors).length > 0) {
				throw ApiError.validation("Validation failed", errors);
			}
		}

		// Rentang baru harus tetap menampung sesi lama bila runsheet tidak dikirim.
		if ((input.starts_at || input.ends_at) && input.sessions === undefined) {
			const sessions = await db
				.select({
					starts_at: internalEventSessions.startsAt,
					ends_at: internalEventSessions.endsAt,
				})
				.from(internalEventSessions)
				.where(eq(internalEventSessions.internalEventId, id));
			const errors = validateSessionsInRange(
				startsAt,
				endsAt,
				sessions.map((s) => ({ startsAt: s.starts_at, endsAt: s.ends_at })),
			);
			if (Object.keys(errors).length > 0) {
				throw ApiError.validation("Event range does not cover existing sessions", errors);
			}
		}

		await db
			.update(internalEvents)
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
				...(userId !== undefined && { updatedByUserId: userId }),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(internalEvents.id, id));

		if (input.sessions !== undefined) {
			await db.delete(internalEventSessions).where(eq(internalEventSessions.internalEventId, id));
			if (input.sessions.length) {
				await this.insertSessions(db, id, input.sessions);
			}
		}

		return this.getWithSessions(db, id, { divisionId: ev.divisionId, isAll: true });
	},

	async delete(db: Db, id: string) {
		const result = await db.delete(internalEvents).where(eq(internalEvents.id, id)).returning();
		if (!result.length) throw ApiError.notFound("Internal event not found");
		return result[0];
	},

	async addSession(db: Db, eventId: string, input: CreateSessionInput) {
		const ev = await this.getOr404(db, eventId);
		await this.insertSessions(db, ev.id, [input]);
		return this.getWithSessions(db, ev.id, { divisionId: ev.divisionId, isAll: true });
	},

	async updateSession(db: Db, sessionId: string, input: UpdateSessionInput) {
		const [existing] = await db
			.select()
			.from(internalEventSessions)
			.where(eq(internalEventSessions.id, sessionId))
			.limit(1);
		if (!existing) throw ApiError.notFound("Session not found");

		const [ev] = await db
			.select()
			.from(internalEvents)
			.where(eq(internalEvents.id, existing.internalEventId))
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
			.update(internalEventSessions)
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
			.where(eq(internalEventSessions.id, sessionId));

		return this.getWithSessions(db, existing.internalEventId, {
			divisionId: ev?.divisionId,
			isAll: true,
		});
	},

	async deleteSession(db: Db, sessionId: string) {
		const result = await db
			.delete(internalEventSessions)
			.where(eq(internalEventSessions.id, sessionId))
			.returning();
		if (!result.length) throw ApiError.notFound("Session not found");
	},

	async reorderSessions(db: Db, eventId: string, sessionIds: string[]) {
		await this.getOr404(db, eventId);

		const rows = await db
			.select({ id: internalEventSessions.id })
			.from(internalEventSessions)
			.where(
				and(
					eq(internalEventSessions.internalEventId, eventId),
					inArray(internalEventSessions.id, sessionIds),
				),
			);

		if (rows.length !== sessionIds.length) {
			throw ApiError.validation("Validation failed", {
				session_ids: ["Some session ids do not belong to this event"],
			});
		}

		// Update berurutan, bukan bulk CASE — jumlah sesi per event ≤ 100.
		for (const [i, sid] of sessionIds.entries()) {
			await db
				.update(internalEventSessions)
				.set({ sortOrder: i })
				.where(eq(internalEventSessions.id, sid));
		}

		return this.getWithSessions(db, eventId, { isAll: true });
	},

	/**
	 * Daftar internal event untuk panel.
	 *
	 * K-2: `published` semua divisi ikut terbaca; `draft` hanya divisi viewer
	 * (platform_admin melihat semuanya).
	 */
	async listAdmin(
		db: Db,
		viewer: InternalEventViewer,
		options?: { page?: number; perPage?: number },
	) {
		const page = Math.max(1, options?.page ?? 1);
		const perPage = Math.min(200, Math.max(1, options?.perPage ?? 200));

		const scope = viewer.isAll
			? undefined
			: viewer.divisionId
				? or(
						eq(internalEvents.status, "published"),
						eq(internalEvents.divisionId, viewer.divisionId),
					)
				: sql`1=0`;

		const rows = await db
			.select({ event: internalEvents, divisionName: divisions.name })
			.from(internalEvents)
			.leftJoin(divisions, eq(internalEvents.divisionId, divisions.id))
			.where(scope)
			.orderBy(desc(internalEvents.startsAtMs))
			.limit(perPage)
			.offset((page - 1) * perPage);

		const [totalRow] = await db
			.select({ n: sql<number>`count(*)` })
			.from(internalEvents)
			.where(scope ?? sql`1=1`);

		const all = rows.length
			? await db
					.select()
					.from(internalEventSessions)
					.where(inArray(internalEventSessions.internalEventId, rows.map((r) => r.event.id)))
					.orderBy(asc(internalEventSessions.sortOrder), asc(internalEventSessions.startsAtMs))
			: [];

		const byEvent = new Map<string, InternalSessionRow[]>();
		for (const s of all) {
			const arr = byEvent.get(s.internalEventId) ?? [];
			arr.push(s);
			byEvent.set(s.internalEventId, arr);
		}

		return {
			items: rows.map((r) =>
				toAdminShape(r.event, byEvent.get(r.event.id) || [], r.divisionName),
			),
			meta: { page, per_page: perPage, total: Number(totalRow?.n ?? 0) },
		};
	},

	/**
	 * Kalender internal lintas divisi per bulan (WIB). Hanya `published` —
	 * draft divisi lain tidak boleh muncul di kalender koordinasi.
	 */
	async calendar(db: Db, month: string) {
		const { startMs, endMs } = monthRangeWib(month);
		const rows = await db
			.select({
				id: internalEvents.id,
				slug: internalEvents.slug,
				title: internalEvents.title,
				description: internalEvents.description,
				starts_at: internalEvents.startsAt,
				ends_at: internalEvents.endsAt,
				location: internalEvents.location,
				organizer: internalEvents.organizer,
				division_id: internalEvents.divisionId,
				division_name: divisions.name,
				startsAtMs: internalEvents.startsAtMs,
				endsAtMs: internalEvents.endsAtMs,
			})
			.from(internalEvents)
			// LEFT JOIN, bukan INNER: division_id NOT NULL + FK restrict menjamin
			// pasangannya ada, tapi join kiri membuat baris tidak mungkin hilang
			// diam-diam bila suatu saat divisi dinonaktifkan.
			.leftJoin(divisions, eq(internalEvents.divisionId, divisions.id))
			.where(
				and(
					eq(internalEvents.status, "published"),
					// Rentang event beririsan dengan bulan — event multi-hari tetap masuk.
					lte(internalEvents.startsAtMs, endMs - 1),
					gte(internalEvents.endsAtMs, startMs),
				),
			)
			.orderBy(asc(internalEvents.startsAtMs));

		return {
			items: rows.map(({ startsAtMs, endsAtMs, ...rest }) => rest),
		};
	},

	async setStatus(db: Db, id: string, status: "draft" | "published") {
		await this.getOr404(db, id);
		await db
			.update(internalEvents)
			.set({ status, updatedAt: new Date().toISOString() })
			.where(eq(internalEvents.id, id));
		return this.getWithSessions(db, id, { isAll: true });
	},

	async getOr404(db: Db, id: string): Promise<InternalEventRow> {
		const [row] = await db
			.select()
			.from(internalEvents)
			.where(eq(internalEvents.id, id))
			.limit(1);
		if (!row) throw ApiError.notFound("Internal event not found");
		return row;
	},

	async assertSlugFree(db: Db, slug: string, exceptId?: string) {
		const [row] = await db
			.select({ id: internalEvents.id })
			.from(internalEvents)
			.where(eq(internalEvents.slug, slug))
			.limit(1);
		if (row && row.id !== exceptId) {
			throw ApiError.conflict("Slug already exists");
		}
	},
};
