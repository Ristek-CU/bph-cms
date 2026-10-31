-- QPR: snapshot & roster hanya terkunci selama kampanye berstatus `open`.
--
-- Sebelumnya trigger mengunci permanen sejak `first_opened_at`. Aturan baru:
-- periode yang sudah pernah dibuka boleh ditutup sementara (status `closed`),
-- diedit (pertanyaan/instrumen/roster), lalu dibuka kembali tanpa kehilangan
-- respons lama. Respons disimpan terpisah di qpr_responses/qpr_answers dan
-- dipetakan lewat question_id, jadi edit snapshot tidak menghapus jawaban.
--
-- Semua trigger di bawah hanya memblokir saat status periode = 'open', yaitu
-- saat pengisian sedang berjalan. `first_opened_at` tetap penanda historis dan
-- tidak dapat diubah (qpr_first_open_immutable tidak disentuh).

DROP TRIGGER qpr_period_snapshot_frozen;
--> statement-breakpoint
CREATE TRIGGER qpr_period_snapshot_frozen BEFORE UPDATE OF questions, form_kind ON qpr_periods
WHEN OLD.status = 'open' AND (NEW.questions != OLD.questions OR NEW.form_kind != OLD.form_kind)
BEGIN SELECT RAISE(ABORT, 'QPR snapshot frozen'); END;
--> statement-breakpoint
DROP TRIGGER qpr_roster_insert_frozen;
--> statement-breakpoint
CREATE TRIGGER qpr_roster_insert_frozen BEFORE INSERT ON qpr_entries
WHEN EXISTS (SELECT 1 FROM qpr_periods WHERE id = NEW.period_id AND status = 'open')
BEGIN SELECT RAISE(ABORT, 'QPR roster frozen'); END;
--> statement-breakpoint
DROP TRIGGER qpr_roster_update_frozen;
--> statement-breakpoint
CREATE TRIGGER qpr_roster_update_frozen BEFORE UPDATE OF period_id, name, division, member_role, division_slug, member_key ON qpr_entries
WHEN EXISTS (SELECT 1 FROM qpr_periods WHERE id IN (OLD.period_id, NEW.period_id) AND status = 'open')
AND (NEW.period_id != OLD.period_id OR NEW.name != OLD.name OR NEW.division IS NOT OLD.division
 OR NEW.member_role IS NOT OLD.member_role OR NEW.division_slug IS NOT OLD.division_slug OR NEW.member_key IS NOT OLD.member_key)
BEGIN SELECT RAISE(ABORT, 'QPR roster frozen'); END;
--> statement-breakpoint
DROP TRIGGER qpr_roster_delete_frozen;
--> statement-breakpoint
CREATE TRIGGER qpr_roster_delete_frozen BEFORE DELETE ON qpr_entries
WHEN EXISTS (SELECT 1 FROM qpr_periods WHERE id = OLD.period_id AND status = 'open')
BEGIN SELECT RAISE(ABORT, 'QPR roster frozen'); END;
--> statement-breakpoint
DROP TRIGGER qpr_roster_managed_frozen;
--> statement-breakpoint
CREATE TRIGGER qpr_roster_managed_frozen BEFORE UPDATE OF managed_divisions ON qpr_entries
WHEN EXISTS (SELECT 1 FROM qpr_periods WHERE id IN (OLD.period_id, NEW.period_id) AND status = 'open')
AND NEW.managed_divisions IS NOT OLD.managed_divisions
BEGIN SELECT RAISE(ABORT, 'QPR roster frozen'); END;
