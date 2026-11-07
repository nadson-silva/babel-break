PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- M6 (C5/C6): antes de recriar com FK, descarta órfãos históricos — a
-- inserção SELECT ... do restructure falharia na migração inteira se sobrasse
-- qualquer linha apontando para alvo extinto.
DELETE FROM attempts WHERE exercise_id NOT IN (SELECT id FROM exercises);--> statement-breakpoint
DELETE FROM lesson_items WHERE lesson_id NOT IN (SELECT id FROM lessons);--> statement-breakpoint
DELETE FROM messages WHERE conversation_id NOT IN (SELECT id FROM conversations);--> statement-breakpoint
DELETE FROM reviews WHERE card_id NOT IN (SELECT id FROM cards);--> statement-breakpoint
CREATE TABLE `__new_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exercise_id` integer NOT NULL,
	`response` text NOT NULL,
	`correct` integer NOT NULL,
	`score` real,
	`latency_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_attempts`("id", "exercise_id", "response", "correct", "score", "latency_ms", "created_at") SELECT "id", "exercise_id", "response", "correct", "score", "latency_ms", "created_at" FROM `attempts`;--> statement-breakpoint
DROP TABLE `attempts`;--> statement-breakpoint
ALTER TABLE `__new_attempts` RENAME TO `attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `attempts_exercise_idx` ON `attempts` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `__new_lesson_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_lesson_items`("id", "lesson_id", "kind", "payload") SELECT "id", "lesson_id", "kind", "payload" FROM `lesson_items`;--> statement-breakpoint
DROP TABLE `lesson_items`;--> statement-breakpoint
ALTER TABLE `__new_lesson_items` RENAME TO `lesson_items`;--> statement-breakpoint
CREATE INDEX `lesson_items_lesson_idx` ON `lesson_items` (`lesson_id`);--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`corrections` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "conversation_id", "role", "content", "corrections", "created_at") SELECT "id", "conversation_id", "role", "content", "corrections", "created_at" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `__new_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`reviewed_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_reviews`("id", "card_id", "rating", "reviewed_at") SELECT "id", "card_id", "rating", "reviewed_at" FROM `reviews`;--> statement-breakpoint
DROP TABLE `reviews`;--> statement-breakpoint
ALTER TABLE `__new_reviews` RENAME TO `reviews`;--> statement-breakpoint
CREATE INDEX `reviews_card_idx` ON `reviews` (`card_id`);--> statement-breakpoint
CREATE INDEX `reviews_time_idx` ON `reviews` (`reviewed_at`);--> statement-breakpoint
CREATE INDEX `exercises_lesson_idx` ON `exercises` (`lesson_id`, `blocked`);
