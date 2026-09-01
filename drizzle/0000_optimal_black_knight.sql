CREATE TABLE `event_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`starts_at_ms` integer NOT NULL,
	`ends_at_ms` integer NOT NULL,
	`speaker` text,
	`location` text,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_sessions_event_idx` ON `event_sessions` (`event_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cover_image_url` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`starts_at_ms` integer NOT NULL,
	`ends_at_ms` integer NOT NULL,
	`location` text NOT NULL,
	`location_url` text,
	`registration_url` text,
	`registration_open` integer DEFAULT true NOT NULL,
	`organizer` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_slug_unique` ON `events` (`slug`);--> statement-breakpoint
CREATE INDEX `events_slug_idx` ON `events` (`slug`);--> statement-breakpoint
CREATE INDEX `events_starts_at_idx` ON `events` (`starts_at`);--> statement-breakpoint
CREATE INDEX `events_status_starts_idx` ON `events` (`status`,`starts_at`);