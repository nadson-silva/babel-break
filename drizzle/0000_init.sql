CREATE TABLE `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exercise_id` integer NOT NULL,
	`response` text NOT NULL,
	`correct` integer NOT NULL,
	`score` real,
	`latency_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`content` text NOT NULL,
	`stability` real,
	`difficulty` real,
	`due` integer NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`lesson_id` integer,
	`mode` text DEFAULT 'free' NOT NULL,
	`topic` text,
	`scenario` text,
	`summary` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`category` text NOT NULL,
	`tag` text NOT NULL,
	`original` text NOT NULL,
	`corrected` text NOT NULL,
	`context` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`answer_key` text NOT NULL,
	`source` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `focus_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`title` text NOT NULL,
	`goal_tag` text,
	`level_range` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `languages` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`script_direction` text DEFAULT 'ltr' NOT NULL,
	`tokenization` text DEFAULT 'space' NOT NULL,
	`prompt_notes` text
);
--> statement-breakpoint
CREATE TABLE `lesson_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lesson_progress` (
	`profile_id` integer NOT NULL,
	`lesson_id` integer NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`last_opened_at` integer,
	`score` real,
	PRIMARY KEY(`profile_id`, `lesson_id`)
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer,
	`track_id` integer,
	`title` text NOT NULL,
	`level` text NOT NULL,
	`content` text,
	`scenario` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_lang` text DEFAULT 'en' NOT NULL,
	`native_lang` text DEFAULT 'pt-BR' NOT NULL,
	`goal` text,
	`cefr` text,
	`focus_mix` real DEFAULT 0.3 NOT NULL,
	`prefs` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`reviewed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenario_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer,
	`conversation_id` integer NOT NULL,
	`content_score` real,
	`language_score` real,
	`feedback` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills_state` (
	`profile_id` integer NOT NULL,
	`skill` text NOT NULL,
	`estimate` real DEFAULT 0 NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`profile_id`, `skill`)
);
--> statement-breakpoint
CREATE TABLE `study_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`summary` text
);
--> statement-breakpoint
CREATE TABLE `track_lessons` (
	`track_id` integer NOT NULL,
	`lesson_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`track_id`, `lesson_id`)
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`title` text NOT NULL,
	`level` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
