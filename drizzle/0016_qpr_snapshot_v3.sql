ALTER TABLE qpr_periods ADD COLUMN first_opened_at text;
--> statement-breakpoint
UPDATE qpr_periods SET first_opened_at = created_at
WHERE status IN ('open', 'closed') OR EXISTS (
 SELECT 1 FROM qpr_entries e WHERE e.period_id = qpr_periods.id
 AND (e.done = 1 OR e.draft_answers IS NOT NULL OR EXISTS (SELECT 1 FROM qpr_answers a WHERE a.entry_id = e.id))
);
--> statement-breakpoint
-- Existing nonempty keys stay exact. Duplicate or synthetic-key collision fails unique-index creation; BPH must map explicitly.
UPDATE qpr_entries SET member_key = 'legacy:' || id WHERE member_key IS NULL OR trim(member_key) = '';
--> statement-breakpoint
DROP INDEX qpr_entries_period_name_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX qpr_entries_period_member_unique ON qpr_entries(period_id, member_key);
--> statement-breakpoint
CREATE TRIGGER qpr_period_snapshot_frozen BEFORE UPDATE OF questions, form_kind ON qpr_periods
WHEN OLD.first_opened_at IS NOT NULL AND (NEW.questions != OLD.questions OR NEW.form_kind != OLD.form_kind)
BEGIN SELECT RAISE(ABORT, 'QPR snapshot frozen'); END;
--> statement-breakpoint
CREATE TRIGGER qpr_roster_insert_frozen BEFORE INSERT ON qpr_entries
WHEN EXISTS (SELECT 1 FROM qpr_periods WHERE id = NEW.period_id AND first_opened_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'QPR roster frozen'); END;
--> statement-breakpoint
CREATE TRIGGER qpr_roster_update_frozen BEFORE UPDATE OF period_id, name, division, member_role, division_slug, member_key ON qpr_entries
WHEN EXISTS (SELECT 1 FROM qpr_periods WHERE id IN (OLD.period_id, NEW.period_id) AND first_opened_at IS NOT NULL)
AND (NEW.period_id != OLD.period_id OR NEW.name != OLD.name OR NEW.division IS NOT OLD.division
 OR NEW.member_role IS NOT OLD.member_role OR NEW.division_slug IS NOT OLD.division_slug OR NEW.member_key IS NOT OLD.member_key)
BEGIN SELECT RAISE(ABORT, 'QPR roster frozen'); END;
--> statement-breakpoint
CREATE TRIGGER qpr_roster_delete_frozen BEFORE DELETE ON qpr_entries
WHEN EXISTS (SELECT 1 FROM qpr_periods WHERE id = OLD.period_id AND first_opened_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'QPR roster frozen'); END;
--> statement-breakpoint
CREATE TRIGGER qpr_first_open_immutable BEFORE UPDATE OF first_opened_at ON qpr_periods
WHEN OLD.first_opened_at IS NOT NULL AND NEW.first_opened_at IS NOT OLD.first_opened_at
BEGIN SELECT RAISE(ABORT, 'QPR first-open marker frozen'); END;
--> statement-breakpoint
CREATE TRIGGER qpr_legacy_name_insert BEFORE INSERT ON qpr_entries
WHEN EXISTS (SELECT 1 FROM qpr_periods p WHERE p.id=NEW.period_id AND json_type(p.questions)='array')
AND EXISTS (SELECT 1 FROM qpr_entries e WHERE e.period_id=NEW.period_id AND lower(trim(e.name))=lower(trim(NEW.name)))
BEGIN SELECT RAISE(ABORT, 'QPR legacy name duplicate'); END;
--> statement-breakpoint
CREATE TRIGGER qpr_legacy_name_update BEFORE UPDATE OF name, period_id ON qpr_entries
WHEN EXISTS (SELECT 1 FROM qpr_periods p WHERE p.id=NEW.period_id AND json_type(p.questions)='array')
AND EXISTS (SELECT 1 FROM qpr_entries e WHERE e.period_id=NEW.period_id AND e.id != OLD.id AND lower(trim(e.name))=lower(trim(NEW.name)))
BEGIN SELECT RAISE(ABORT, 'QPR legacy name duplicate'); END;
