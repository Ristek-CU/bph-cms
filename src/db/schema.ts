import { relations, sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const events = sqliteTable(
	"events",
	{
		id: text("id").primaryKey(),
		slug: text("slug").notNull().unique(),
		title: text("title").notNull(),
		description: text("description"),
		coverImageUrl: text("cover_image_url"),
		startsAt: text("starts_at").notNull(),
		endsAt: text("ends_at").notNull(),
		// ponytail: epoch ms mirrors of starts_at/ends_at — string ISO offsets can't be
		// compared in SQL; ms columns make status filter/sort one indexed comparison.
		startsAtMs: integer("starts_at_ms").notNull(),
		endsAtMs: integer("ends_at_ms").notNull(),
		location: text("location").notNull(),
		locationUrl: text("location_url"),
		registrationUrl: text("registration_url"),
		registrationOpen: integer("registration_open", { mode: "boolean" })
			.notNull()
			.default(true),
		organizer: text("organizer"),
		status: text("status", { enum: ["draft", "published"] })
			.notNull()
			.default("draft"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		index("events_slug_idx").on(table.slug),
		index("events_starts_at_idx").on(table.startsAt),
		index("events_status_starts_idx").on(table.status, table.startsAt),
	],
);

export const eventSessions = sqliteTable(
	"event_sessions",
	{
		id: text("id").primaryKey(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		startsAt: text("starts_at").notNull(),
		endsAt: text("ends_at").notNull(),
		startsAtMs: integer("starts_at_ms").notNull(),
		endsAtMs: integer("ends_at_ms").notNull(),
		speaker: text("speaker"),
		location: text("location"),
		description: text("description"),
		sortOrder: integer("sort_order").notNull().default(0),
	},
	(table) => [index("event_sessions_event_idx").on(table.eventId, table.startsAt)],
);

export const eventsRelations = relations(events, ({ many }) => ({
	sessions: many(eventSessions),
}));

export const eventSessionsRelations = relations(eventSessions, ({ one }) => ({
	event: one(events, { fields: [eventSessions.eventId], references: [events.id] }),
}));
