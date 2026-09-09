CREATE TABLE `workspace_handoffs` (
	`code` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_email` text NOT NULL,
	`division_id` text NOT NULL,
	`target_workspace_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_workspace_id`) REFERENCES `workspace_options`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_handoffs_expires_idx` ON `workspace_handoffs` (`expires_at`);