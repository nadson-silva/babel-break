ALTER TABLE `exercises` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `lessons` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `onboarding_completed_at` integer;--> statement-breakpoint
ALTER TABLE `profiles` ADD `placement_score` real;--> statement-breakpoint
ALTER TABLE `units` ADD `description` text;