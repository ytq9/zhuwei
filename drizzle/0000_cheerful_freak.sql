CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`sheet` text NOT NULL,
	`locked` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_characters_room_user` ON `characters` (`room_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `game_states` (
	`room_id` text PRIMARY KEY NOT NULL,
	`chapter_id` text DEFAULT 'ch1' NOT NULL,
	`scene_id` text DEFAULT 'wake' NOT NULL,
	`revealed_clues` text DEFAULT '[]' NOT NULL,
	`npc_flags` text DEFAULT '{}' NOT NULL,
	`pending_rolls` text DEFAULT '[]' NOT NULL,
	`kp_busy` integer DEFAULT false NOT NULL,
	`secret` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_room_created` ON `messages` (`room_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `room_members` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`nickname` text NOT NULL,
	`is_host` integer DEFAULT false NOT NULL,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`room_id`, `user_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_room_members_user` ON `room_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`host_user_id` text NOT NULL,
	`title` text NOT NULL,
	`module_id` text DEFAULT 'black-oak-will' NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rooms_code` ON `rooms` (`code`);--> statement-breakpoint
CREATE INDEX `idx_rooms_host` ON `rooms` (`host_user_id`);--> statement-breakpoint
CREATE TABLE `session_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`entry` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_logs_room_created` ON `session_logs` (`room_id`,`created_at`);