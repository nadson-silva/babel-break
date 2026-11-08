CREATE TABLE `audio_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`profile_id` integer NOT NULL,
	`kind` text DEFAULT 'tts' NOT NULL,
	`text` text NOT NULL,
	`lang` text NOT NULL,
	`voice` text,
	`model` text,
	`mime` text DEFAULT 'audio/wav' NOT NULL,
	`bytes` blob NOT NULL,
	`duration_ms` integer,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer DEFAULT 0 NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `speech_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`lesson_id` integer,
	`exercise_id` integer,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`transcript` text,
	`score` real,
	`skill` text NOT NULL,
	`metrics` text,
	`source` text DEFAULT 'provider' NOT NULL,
	`model` text,
	`latency_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `speech_runs_profile_idx` ON `speech_runs` (`profile_id`);--> statement-breakpoint
CREATE INDEX `speech_runs_lesson_idx` ON `speech_runs` (`lesson_id`);