ALTER TABLE `cards` ADD `kind` text DEFAULT 'vocab' NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `source` text DEFAULT 'lesson' NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `lesson_id` integer;--> statement-breakpoint
ALTER TABLE `cards` ADD `dedupe_key` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `schedule` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `last_review_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `cards_profile_dedupe_idx` ON `cards` (`profile_id`,`dedupe_key`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `last_message_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `closed_at` integer;--> statement-breakpoint
ALTER TABLE `errors` ADD `note` text;--> statement-breakpoint
ALTER TABLE `errors` ADD `occurrences` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `errors` ADD `source` text;--> statement-breakpoint
ALTER TABLE `errors` ADD `last_seen_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `corrections` text;