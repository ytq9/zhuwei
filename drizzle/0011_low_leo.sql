CREATE TABLE `authoritative_room_archive_checkpoint` (
	`room_id` text NOT NULL,
	`runtime_epoch_id` text NOT NULL,
	`genesis_hash` text NOT NULL,
	`settled_event_seq` integer NOT NULL,
	`event_hash` text NOT NULL,
	`state_hash` text NOT NULL,
	`active_branch_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `runtime_epoch_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
