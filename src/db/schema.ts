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

// Kode sekali pakai untuk handoff sesi ke dashboard eksternal (SDD §4.5, tugas T2).
// expires_at/used_at/created_at disimpan ISO UTC ber-millisecond (toISOString),
// jadi aman dibandingkan secara leksikografis di SQL tanpa BigInt.
export const workspaceHandoffs = sqliteTable(
	"workspace_handoffs",
	{
		code: text("code").primaryKey(),
		userId: text("user_id").notNull(),
		userEmail: text("user_email").notNull(),
		divisionId: text("division_id")
			.notNull()
			.references(() => divisions.id, { onDelete: "cascade" }),
		targetWorkspaceId: text("target_workspace_id")
			.notNull()
			.references(() => workspaceOptions.id, { onDelete: "cascade" }),
		expiresAt: text("expires_at").notNull(),
		usedAt: text("used_at"),
		createdAt: text("created_at").notNull(),
	},
	(table) => [index("workspace_handoffs_expires_idx").on(table.expiresAt)],
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

// Fixed-window counter. Binding RATE_LIMITER Cloudflare tidak menegakkan limit di
// production (selalu success:true), jadi penegakan nyata ada di sini.
export const rateLimits = sqliteTable(
	"rate_limits",
	{
		rowKey: text("row_key").primaryKey(),
		windowStart: integer("window_start").notNull(),
		count: integer("count").notNull(),
	},
	(table) => [index("rate_limits_window_idx").on(table.windowStart)],
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
		// Cermin epoch ms dari starts_at/ends_at — string ISO ber-offset tidak bisa
		// dibandingkan di SQL; kolom ms membuat filter/sort status jadi satu
		// perbandingan yang ter-index. Lihat PLAN.md D5.
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

// ---- Form builder (multi-divisi) — kontrak publik identik dengan campaign
// AdvocationDashboard supaya landing page cukup ganti base URL. ----

export const forms = sqliteTable(
	"forms",
	{
		id: text("id").primaryKey(),
		divisionId: text("division_id")
			.notNull()
			.references(() => divisions.id, { onDelete: "restrict" }),
		slug: text("slug").notNull().unique(),
		title: text("title").notNull(),
		description: text("description"),
		status: text("status", { enum: ["draft", "published", "closed"] })
			.notNull()
			.default("draft"),
		thankYouMessage: text("thank_you_message")
			.notNull()
			.default("Terima kasih. Respons kamu sudah kami terima."),
		opensAt: text("opens_at"),
		closesAt: text("closes_at"),
		createdByUserId: text("created_by_user_id"),
		updatedByUserId: text("updated_by_user_id"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [index("forms_division_idx").on(table.divisionId, table.createdAt)],
);

export const formFields = sqliteTable(
	"form_fields",
	{
		id: text("id").primaryKey(),
		formId: text("form_id")
			.notNull()
			.references(() => forms.id, { onDelete: "cascade" }),
		label: text("label").notNull(),
		description: text("description"),
		// short_text | paragraph | email | number | multiple_choice | checkboxes |
		// dropdown | linear_scale | date | file — sama dengan kontrak advo.
		type: text("type").notNull(),
		required: integer("required", { mode: "boolean" }).notNull().default(false),
		// JSON array pilihan (choice types) atau {min,max} (linear_scale).
		options: text("options"),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [index("form_fields_form_idx").on(table.formId, table.sortOrder)],
);

export const formSubmissions = sqliteTable(
	"form_submissions",
	{
		id: text("id").primaryKey(),
		formId: text("form_id")
			.notNull()
			.references(() => forms.id, { onDelete: "restrict" }),
		status: text("status", { enum: ["new", "reviewed", "archived"] })
			.notNull()
			.default("new"),
		// SHA-256(secret:ip:ua) — untuk investigasi abuse, bukan pelacakan identitas.
		fingerprint: text("fingerprint"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [index("form_submissions_form_idx").on(table.formId, table.createdAt)],
);

export const formAnswers = sqliteTable(
	"form_answers",
	{
		id: text("id").primaryKey(),
		submissionId: text("submission_id")
			.notNull()
			.references(() => formSubmissions.id, { onDelete: "cascade" }),
		// SetNull: field dihapus → jawaban historis tetap utuh (label disnapshot).
		fieldId: text("field_id").references(() => formFields.id, { onDelete: "set null" }),
		// Snapshot label/type saat submit — edit pertanyaan tidak merusak histori.
		fieldLabel: text("field_label").notNull(),
		fieldType: text("field_type").notNull(),
		// JSON-encoded scalar/array.
		value: text("value").notNull(),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		index("form_answers_submission_idx").on(table.submissionId),
		index("form_answers_field_idx").on(table.fieldId),
	],
);

export const formFiles = sqliteTable(
	"form_files",
	{
		id: text("id").primaryKey(),
		submissionId: text("submission_id")
			.notNull()
			.references(() => formSubmissions.id, { onDelete: "cascade" }),
		fieldId: text("field_id").references(() => formFields.id, { onDelete: "set null" }),
		storagePath: text("storage_path").notNull(),
		originalFilename: text("original_filename").notNull(),
		mimeType: text("mime_type").notNull(),
		fileSize: integer("file_size").notNull(),
		createdAt: text("created_at").notNull(),
	},
	(table) => [index("form_files_submission_idx").on(table.submissionId)],
);

export const formsRelations = relations(forms, ({ one, many }) => ({
	division: one(divisions, { fields: [forms.divisionId], references: [divisions.id] }),
	fields: many(formFields),
}));

export const formFieldsRelations = relations(formFields, ({ one }) => ({
	form: one(forms, { fields: [formFields.formId], references: [forms.id] }),
}));

export const formSubmissionsRelations = relations(formSubmissions, ({ one, many }) => ({
	form: one(forms, { fields: [formSubmissions.formId], references: [forms.id] }),
	answers: many(formAnswers),
	files: many(formFiles),
}));

export const qprPeriods = sqliteTable(
	"qpr_periods",
	{
		id: text("id").primaryKey(),
		title: text("title").notNull().unique(),
		// JSON array [{ label, category }] — v1 QPR tanpa builder terpisah.
		questions: text("questions").notNull(),
		status: text("status", { enum: ["draft", "open", "closed"] })
			.notNull()
			.default("draft"),
		opensAt: text("opens_at"),
		closesAt: text("closes_at"),
		createdByUserId: text("created_by_user_id").notNull(),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
);

export const qprAssignments = sqliteTable(
	"qpr_assignments",
	{
		id: text("id").primaryKey(),
		periodId: text("period_id")
			.notNull()
			.references(() => qprPeriods.id, { onDelete: "cascade" }),
		reviewerUserId: text("reviewer_user_id").notNull(),
		reviewerEmail: text("reviewer_email").notNull(),
		revieweeName: text("reviewee_name").notNull(),
		revieweeRole: text("reviewee_role"),
		status: text("status", { enum: ["pending", "done"] })
			.notNull()
			.default("pending"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [index("qpr_assignments_period_idx").on(table.periodId)],
);

export const qprAnswers = sqliteTable("qpr_answers", {
	id: text("id").primaryKey(),
	assignmentId: text("assignment_id")
		.notNull()
		.references(() => qprAssignments.id, { onDelete: "cascade" }),
	// JSON array [{ label, category, score (1-5), note? }]
	answers: text("answers").notNull(),
	submittedAt: text("submitted_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

export const qprPeriodsRelations = relations(qprPeriods, ({ many }) => ({
	assignments: many(qprAssignments),
}));

export const qprAssignmentsRelations = relations(qprAssignments, ({ one, many }) => ({
	period: one(qprPeriods, { fields: [qprAssignments.periodId], references: [qprPeriods.id] }),
	answers: many(qprAnswers),
}));
