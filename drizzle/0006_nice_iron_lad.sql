CREATE TABLE `authoritative_projection_audit_archive` (
	`room_id` text NOT NULL,
	`runtime_epoch_id` text NOT NULL,
	`event_seq` integer NOT NULL,
	`viewer_hash` text NOT NULL,
	`projection_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`room_id`, `runtime_epoch_id`, `event_seq`, `viewer_hash`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_authoritative_projection_head` ON `authoritative_projection_audit_archive` (`room_id`,`runtime_epoch_id`,`event_seq`);--> statement-breakpoint
CREATE TABLE `authoritative_room_event_archive` (
	`room_id` text NOT NULL,
	`runtime_epoch_id` text NOT NULL,
	`event_seq` integer NOT NULL,
	`event_id` text NOT NULL,
	`root_action_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_type_version` text NOT NULL,
	`manifest_profile_id` text NOT NULL,
	`manifest_profile_hash` text NOT NULL,
	`ruleset_profile_id` text NOT NULL,
	`ruleset_profile_hash` text NOT NULL,
	`event_schema_profile_id` text NOT NULL,
	`event_schema_profile_hash` text NOT NULL,
	`payload_hash` text NOT NULL,
	`previous_event_hash` text NOT NULL,
	`state_before_hash` text NOT NULL,
	`state_hash_after` text NOT NULL,
	`event_hash` text NOT NULL,
	`event_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`room_id`, `runtime_epoch_id`, `event_seq`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_authoritative_event_id` ON `authoritative_room_event_archive` (`room_id`,`runtime_epoch_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `idx_authoritative_event_branch` ON `authoritative_room_event_archive` (`room_id`,`runtime_epoch_id`,`branch_id`,`event_seq`);--> statement-breakpoint
CREATE INDEX `idx_authoritative_event_action` ON `authoritative_room_event_archive` (`room_id`,`runtime_epoch_id`,`root_action_id`);--> statement-breakpoint
CREATE TABLE `authoritative_room_genesis_archive` (
	`room_id` text NOT NULL,
	`runtime_epoch_id` text NOT NULL,
	`genesis_hash` text NOT NULL,
	`manifest_profile_id` text NOT NULL,
	`manifest_profile_hash` text NOT NULL,
	`ruleset_profile_id` text NOT NULL,
	`ruleset_profile_hash` text NOT NULL,
	`event_schema_profile_id` text NOT NULL,
	`event_schema_profile_hash` text NOT NULL,
	`module_profile_id` text NOT NULL,
	`module_profile_hash` text NOT NULL,
	`definition_profile_id` text NOT NULL,
	`definition_profile_hash` text NOT NULL,
	`genesis_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`room_id`, `runtime_epoch_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_authoritative_genesis_hash` ON `authoritative_room_genesis_archive` (`room_id`,`genesis_hash`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `runtime_epoch_id` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `genesis_hash` text;