CREATE TABLE `story_room_archive_part` (
	`room_id` text NOT NULL,
	`runtime_epoch_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`part_index` integer NOT NULL,
	`part_count` integer NOT NULL,
	`part_hash` text NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`room_id`, `runtime_epoch_id`, `content_hash`, `part_index`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `authoritative_room_archive_checkpoint` ADD `story_generation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `authoritative_room_archive_checkpoint` ADD `story_content_hash` text;