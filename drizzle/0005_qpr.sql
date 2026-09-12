-- QPR v1 — penilaian internal (docs/QPR-PRD.md §5: skala 1-5 + teks,
-- penugasan manual, rekap rata-rata sederhana).
-- Pertanyaan periode disimpan sebagai JSON di qpr_periods — builder terpisah
-- untuk QPR tidak dibutuhkan sampai diminta (YAGNI).
CREATE TABLE `qpr_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`questions` text NOT NULL, -- JSON: [{ label, category }]
	`status` text DEFAULT 'draft' NOT NULL, -- draft | open | closed
	`opens_at` text,
	`closes_at` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qpr_periods_title_unique` ON `qpr_periods` (`title`);--> statement-breakpoint
CREATE TABLE `qpr_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`period_id` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`reviewer_email` text NOT NULL,
	`reviewee_name` text NOT NULL,
	`reviewee_role` text, -- mis. "Anggota Ristek", "Ketua UKM"
	`status` text DEFAULT 'pending' NOT NULL, -- pending | done
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `qpr_periods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `qpr_assignments_period_idx` ON `qpr_assignments` (`period_id`);--> statement-breakpoint
CREATE INDEX `qpr_assignments_reviewer_idx` ON `qpr_assignments` (`reviewer_user_id`);--> statement-breakpoint
CREATE TABLE `qpr_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`answers` text NOT NULL, -- JSON: [{ label, category, score(1-5), note? }]
	`submitted_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `qpr_assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
