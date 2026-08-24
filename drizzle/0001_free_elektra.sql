ALTER TABLE `game_states` ADD `combat` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `tts_text` text;--> statement-breakpoint
ALTER TABLE `room_members` ADD `seated` integer DEFAULT true NOT NULL;