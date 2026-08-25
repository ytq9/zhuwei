CREATE TABLE `room_event_archive` (
	`room_id` text NOT NULL,
	`version` integer NOT NULL,
	`event_id` text NOT NULL,
	`command_id` text NOT NULL,
	`event_type` text NOT NULL,
	`fiction_seconds` integer NOT NULL,
	`event_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`room_id`, `version`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_room_event_archive_event` ON `room_event_archive` (`room_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `idx_room_event_archive_command` ON `room_event_archive` (`room_id`,`command_id`);