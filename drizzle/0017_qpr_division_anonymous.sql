-- QPR per-divisi + jawaban final anonim.
--
-- Dua perubahan, keduanya tambatif (tidak ada drop/rename — data legacy
-- qpr_periods/qpr_entries/qpr_answers tetap utuh):
--
-- 1. `qpr_periods.division_slug`: pengikat satu periode QPR = satu divisi.
--    Null = periode lama / belum dipetakan (tidak memaksa migrasi data).
-- 2. Tabel `qpr_responses`: jawaban FINAL anonim untuk periode snapshot
--    (v2/v3). Sengaja TIDAK punya kolom entry_id — partisipasi tetap dilacak
--    lewat qpr_entries.done, tetapi isi jawaban tidak bisa dipetakan ke orang.
--    `role`/`division_slug` disimpan hanya untuk routing & agregasi, bukan
--    identitas. qpr_answers lama tetap dipakai periode legacy/bph lama.

ALTER TABLE `qpr_periods` ADD `division_slug` text;
--> statement-breakpoint
CREATE TABLE `qpr_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`period_id` text NOT NULL,
	`role` text,
	`division_slug` text,
	`answers` text NOT NULL, -- JSON: [{ question_id, value }]
	`score_total` integer DEFAULT 0 NOT NULL, -- akumulasi nilai skala 1-5
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `qpr_periods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `qpr_responses_period_idx` ON `qpr_responses` (`period_id`);