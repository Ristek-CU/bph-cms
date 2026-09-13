-- Keunikan QPR (audit M3): (period_id, name) unik — tidak ada nama ganda di
-- roster; entry_id unik di qpr_answers — tidak ada jawaban ganda per nama.
CREATE UNIQUE INDEX IF NOT EXISTS `qpr_entries_period_name_unique` ON `qpr_entries` (`period_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `qpr_answers_entry_unique` ON `qpr_answers` (`entry_id`);
