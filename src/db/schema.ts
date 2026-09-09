import { relations, sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const divisions = sqliteTable(
	"divisions",
	{
		id: text("id").primaryKey(),
		slug: text("slug").notNull().unique(),
		name: text("name").notNull(),
		email: text("email"),
		dashboardUrl: text("dashboard_url"),
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [index("divisions_slug_idx").on(table.slug)],
);

export const cmsMemberships = sqliteTable(
	"cms_memberships",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		userEmail: text("user_email").notNull(),
		divisionId: text("division_id")
			.notNull()
			.references(() => divisions.id, { onDelete: "restrict" }),
		role: text("role", {
			enum: ["platform_admin", "division_admin", "contributor", "viewer"],
		}).notNull(),
		status: text("status", { enum: ["active", "suspended"] })
			.notNull()
			.default("active"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("cms_memberships_user_division_unique").on(table.userId, table.divisionId),
		index("cms_memberships_user_idx").on(table.userId),
		index("cms_memberships_email_idx").on(table.userEmail),
	],
);

export const workspaceOptions = sqliteTable(
	"workspace_options",
	{
		id: text("id").primaryKey(),
		divisionId: text("division_id")
			.notNull()
			.references(() => divisions.id, { onDelete: "cascade" }),
		label: text("label").notNull(),
		kind: text("kind", { enum: ["cms_hub", "external_dashboard"] }).notNull(),
		url: text("url"),
		sortOrder: integer("sort_order").notNull().default(0),
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	},
	(table) => [index("workspace_options_division_idx").on(table.divisionId, table.sortOrder)],
);

export const auditLogs = sqliteTable(
	"audit_logs",
	{
		id: text("id").primaryKey(),
		actorUserId: text("actor_user_id"),
		actorEmail: text("actor_email"),
		actorDivisionId: text("actor_division_id"),
		action: text("action").notNull(),
		resourceType: text("resource_type").notNull(),
		resourceId: text("resource_id"),
		metadata: text("metadata"),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		index("audit_logs_actor_idx").on(table.actorUserId, table.createdAt),
		index("audit_logs_resource_idx").on(table.resourceType, table.resourceId),
	],
);

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
		divisionId: text("division_id").references(() => divisions.id),
		createdByUserId: text("created_by_user_id"),
		updatedByUserId: text("updated_by_user_id"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		index("events_slug_idx").on(table.slug),
		index("events_starts_at_idx").on(table.startsAt),
		index("events_status_starts_idx").on(table.status, table.startsAt),
		index("events_division_idx").on(table.divisionId),
		index("events_division_status_starts_idx").on(table.divisionId, table.status, table.startsAtMs),
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

export const divisionsRelations = relations(divisions, ({ many }) => ({
	memberships: many(cmsMemberships),
	workspaceOptions: many(workspaceOptions),
	events: many(events),
}));

export const cmsMembershipsRelations = relations(cmsMemberships, ({ one }) => ({
	division: one(divisions, { fields: [cmsMemberships.divisionId], references: [divisions.id] }),
}));

export const workspaceOptionsRelations = relations(workspaceOptions, ({ one }) => ({
	division: one(divisions, { fields: [workspaceOptions.divisionId], references: [divisions.id] }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
	sessions: many(eventSessions),
	division: one(divisions, { fields: [events.divisionId], references: [divisions.id] }),
}));

export const eventSessionsRelations = relations(eventSessions, ({ one }) => ({
	event: one(events, { fields: [eventSessions.eventId], references: [events.id] }),
}));
