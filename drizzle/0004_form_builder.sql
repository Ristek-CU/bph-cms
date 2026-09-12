-- Form builder multi-divisi (kontrak publik identik dengan campaign AdvocationDashboard
-- supaya landing page bisa pindah base URL tanpa ubah komponen form).
CREATE TABLE `forms` (
	`id` text PRIMARY KEY NOT NULL,
	`division_id` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`thank_you_message` text DEFAULT 'Terima kasih. Respons kamu sudah kami terima.' NOT NULL,
	`opens_at` text,
	`closes_at` text,
	`created_by_user_id` text,
	`updated_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `forms_division_idx` ON `forms` (`division_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `form_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`options` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `form_fields_form_idx` ON `form_fields` (`form_id`, `sort_order`);
--> statement-breakpoint
CREATE TABLE `form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`fingerprint` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `form_submissions_form_idx` ON `form_submissions` (`form_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `form_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`field_id` text,
	`field_label` text NOT NULL,
	`field_type` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `form_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `form_fields`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `form_answers_submission_idx` ON `form_answers` (`submission_id`);
--> statement-breakpoint
CREATE TABLE `form_files` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`field_id` text,
	`storage_path` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `form_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `form_fields`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `form_files_submission_idx` ON `form_files` (`submission_id`);
