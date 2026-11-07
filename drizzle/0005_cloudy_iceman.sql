CREATE TABLE `content_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`kind` text NOT NULL,
	`target_id` integer,
	`reason` text NOT NULL,
	`effect` text DEFAULT 'logged' NOT NULL,
	`note` text,
	`context` text,
	`target_label` text,
	`created_at` integer NOT NULL,
	`undone_at` integer
);
--> statement-breakpoint
ALTER TABLE `errors` ADD `disputed_at` integer;--> statement-breakpoint
ALTER TABLE `exercises` ADD `blocked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `lessons` ADD `prewarmed_at` integer;--> statement-breakpoint
ALTER TABLE `lessons` ADD `stale_at` integer;