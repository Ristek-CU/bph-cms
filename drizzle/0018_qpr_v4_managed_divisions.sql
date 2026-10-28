-- QPR v4 (rubrik 360°): kolom `managed_divisions` di roster.
--
-- Satu controller mengurus 1–3 divisi (berbeda per controller). Daftar slug
-- itu bagian dari identitas roster, jadi ikut terkunci sejak kampanye pertama
-- dibuka seperti nama/jabatan/divisi.
--
-- Tidak ada perubahan pada tabel lain: snapshot v4 tetap disimpan di kolom
-- `qpr_periods.questions` yang sama dengan JSON ber-discriminator
-- {"version":4,"categories":[...]}.

ALTER TABLE `qpr_entries` ADD `managed_divisions` text;
--> statement-breakpoint
-- v4: satu respons bisa menilai banyak orang. Simpan daftar target (ID roster)
-- agar rekap/ekspor tidak perlu menebak dari jabatan+divisi pengisi.
ALTER TABLE `qpr_responses` ADD `target_ids` text;
--> statement-breakpoint
CREATE TRIGGER qpr_roster_managed_frozen BEFORE UPDATE OF managed_divisions ON qpr_entries
WHEN EXISTS (SELECT 1 FROM qpr_periods WHERE id IN (OLD.period_id, NEW.period_id) AND first_opened_at IS NOT NULL)
AND NEW.managed_divisions IS NOT OLD.managed_divisions
BEGIN SELECT RAISE(ABORT, 'QPR roster frozen'); END;