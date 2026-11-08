-- V2 (perfis múltiplos + export/import): migração aditiva com backfill.
--
-- `lessons.profile_id` transforma a posse deduzida por join (`unit_id →
-- units.profile_id` OU `track_id → focus_tracks.profile_id`) em coluna de escopo.
-- Lição sem dono nenhum continua com NULL de propósito: é linha órfã, e
-- export/import da v2 a recusa em vez de exportar perfil corrompido.
ALTER TABLE `lessons` ADD `profile_id` integer;--> statement-breakpoint
UPDATE `lessons` SET `profile_id` = (SELECT `u`.`profile_id` FROM `units` `u` WHERE `u`.`id` = `lessons`.`unit_id`) WHERE `profile_id` IS NULL AND `unit_id` IS NOT NULL;--> statement-breakpoint
UPDATE `lessons` SET `profile_id` = (SELECT `t`.`profile_id` FROM `focus_tracks` `t` WHERE `t`.`id` = `lessons`.`track_id`) WHERE `profile_id` IS NULL AND `track_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `lessons_profile_idx` ON `lessons` (`profile_id`);--> statement-breakpoint
-- Nome/cor são opcionais: sem nome a UI deriva o rótulo do idioma-alvo do perfil,
-- então a migração não grava texto de interface em SQL.
ALTER TABLE `profiles` ADD `name` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `color` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `last_used_at` integer;--> statement-breakpoint
UPDATE `profiles` SET `last_used_at` = `created_at` WHERE `last_used_at` IS NULL;