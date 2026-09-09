CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`actor_email` text,
	`actor_division_id` text,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_resource_idx` ON `audit_logs` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `divisions` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`dashboard_url` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `divisions_slug_unique` ON `divisions` (`slug`);--> statement-breakpoint
CREATE INDEX `divisions_slug_idx` ON `divisions` (`slug`);--> statement-breakpoint
CREATE TABLE `cms_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_email` text NOT NULL,
	`division_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_memberships_user_division_unique` ON `cms_memberships` (`user_id`,`division_id`);--> statement-breakpoint
CREATE INDEX `cms_memberships_user_idx` ON `cms_memberships` (`user_id`);--> statement-breakpoint
CREATE INDEX `cms_memberships_email_idx` ON `cms_memberships` (`user_email`);--> statement-breakpoint
CREATE TABLE `workspace_options` (
	`id` text PRIMARY KEY NOT NULL,
	`division_id` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_options_division_idx` ON `workspace_options` (`division_id`,`sort_order`);--> statement-breakpoint
ALTER TABLE `events` ADD `division_id` text REFERENCES divisions(id);--> statement-breakpoint
ALTER TABLE `events` ADD `created_by_user_id` text;--> statement-breakpoint
ALTER TABLE `events` ADD `updated_by_user_id` text;--> statement-breakpoint
CREATE INDEX `events_division_idx` ON `events` (`division_id`);--> statement-breakpoint
CREATE INDEX `events_division_status_starts_idx` ON `events` (`division_id`,`status`,`starts_at_ms`);--> statement-breakpoint
INSERT OR IGNORE INTO `divisions` (`id`, `slug`, `name`, `email`, `dashboard_url`, `is_active`, `created_at`, `updated_at`) VALUES
('01990001-0000-7000-8000-000000000001', 'bph', 'BPH', 'bph@cakrawala.com', NULL, 1, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z'),
('01990001-0000-7000-8000-000000000002', 'ristek', 'Ristek', 'ristek@cakrawala.com', NULL, 1, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z'),
('01990001-0000-7000-8000-000000000003', 'ukm', 'UKM', 'ukm@cakrawala.ac.id', NULL, 1, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z'),
('01990001-0000-7000-8000-000000000004', 'advo', 'Advokasi', 'advo@cakrawala.ac.id', NULL, 1, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z'),
('01990001-0000-7000-8000-000000000005', 'bnp', 'BNP', 'bnp@cakrawala.ac.id', NULL, 1, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z'),
('01990001-0000-7000-8000-000000000006', 'icd', 'ICD', 'icd@cakrawala.ac.id', NULL, 1, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z'),
('01990001-0000-7000-8000-000000000007', 'pr', 'Public Relation', 'pr@cakrawala.ac.id', NULL, 1, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z'),
('01990001-0000-7000-8000-000000000008', 'media', 'Media', 'media@cakrawala.ac.id', NULL, 1, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z');
--> statement-breakpoint
INSERT OR IGNORE INTO `workspace_options` (`id`, `division_id`, `label`, `kind`, `url`, `sort_order`, `is_active`) VALUES
('01990002-0000-7000-8000-000000000001', '01990001-0000-7000-8000-000000000002', 'Dashboard Terpadu', 'cms_hub', NULL, 0, 1),
('01990002-0000-7000-8000-000000000002', '01990001-0000-7000-8000-000000000002', 'Dashboard Ristek', 'external_dashboard', 'https://ristek.sga-cakrawala.org', 1, 1),
('01990002-0000-7000-8000-000000000003', '01990001-0000-7000-8000-000000000004', 'Dashboard Terpadu', 'cms_hub', NULL, 0, 1),
('01990002-0000-7000-8000-000000000004', '01990001-0000-7000-8000-000000000004', 'Dashboard Advokasi', 'external_dashboard', 'https://satgas.sga-cakrawala.org', 1, 1);
--> statement-breakpoint
UPDATE `events` SET `division_id` = '01990001-0000-7000-8000-000000000001' WHERE `division_id` IS NULL;
