-- QPR v2 tahap 2: format berversi + draft lintas perangkat.
--
-- Dua perubahan, keduanya tambatif (tidak ada drop/rename — data legacy
-- qpr_periods/qpr_entries/qpr_answers tetap utuh):
--
-- 1. `qpr_periods.form_kind`: pembeda jenis form. `legacy` = periode lama
--    dengan questions [{label, category}] (default semua baris existing),
--    `bph` = penilaian BPH dengan snapshot berversi, `division` = QPR divisi.
-- 2. Kolom draft di `qpr_entries`: autosave server-side, lanjut di perangkat
--    mana pun cukup pilih nama (model kejuhuran, keputusan user 2026-10-05).
--
-- Snapshot berversi disimpan di kolom `questions` yang sama dengan JSON
-- ber-discriminator `{"version":2,"sections":[...]}`; periode legacy tetap
-- JSON array polos. Satu kolom, dua format, tidak ada migrasi data.

ALTER TABLE `qpr_periods` ADD `form_kind` text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
-- member_role: jabatan organisasi dari roster (mis. 'kadiv'), snapshot.
ALTER TABLE `qpr_entries` ADD `member_role` text;
--> statement-breakpoint
-- division_slug: slug divisi kanonis, snapshot; label tetap `division`.
ALTER TABLE `qpr_entries` ADD `division_slug` text;
--> statement-breakpoint
-- member_key: ID anggota stabil (bukan nama) — nama kembar terbedakan.
ALTER TABLE `qpr_entries` ADD `member_key` text;
--> statement-breakpoint
-- draft_answers: JSON [{question_id, value}] — null = belum pernah simpan.
ALTER TABLE `qpr_entries` ADD `draft_answers` text;
--> statement-breakpoint
-- draft_version: CAS lintas perangkat.
ALTER TABLE `qpr_entries` ADD `draft_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- draft_updated_at: kapan terakhir autosave.
ALTER TABLE `qpr_entries` ADD `draft_updated_at` text;
