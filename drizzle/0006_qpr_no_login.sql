-- QPR v2: tanpa login. Periode punya daftar nama pengisi (roster).
-- Anggota buka link publik, pilih namanya, isi, nama terkunci (done).
-- Tabel v1 (qpr_assignments/qpr_answers) belum pernah dipakai produksi
-- (data smoke test sudah dihapus) — drop, ganti model sederhana.
DROP TABLE IF EXISTS `qpr_answers`;
DROP TABLE IF EXISTS `qpr_assignments`;
DROP TABLE IF EXISTS `qpr_periods`;
--> statement-breakpoint
CREATE TABLE `qpr_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text, -- mis. "Menilai: Ketua Ristek"
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
CREATE TABLE `qpr_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`period_id` text NOT NULL,
	`name` text NOT NULL,
	`division` text, -- opsional, mis. "Ristek"
	`done` integer DEFAULT 0 NOT NULL, -- 1 = sudah submit (hilang dari dropdown)
	`submitted_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `qpr_periods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `qpr_entries_period_idx` ON `qpr_entries` (`period_id`);--> statement-breakpoint
CREATE TABLE `qpr_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`answers` text NOT NULL, -- JSON: [{ label, category, score(1-5), note? }]
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `qpr_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
