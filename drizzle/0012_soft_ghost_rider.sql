DROP TABLE `game_states`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
DROP TABLE `room_event_archive`;--> statement-breakpoint
DROP TABLE `session_logs`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`host_user_id` text NOT NULL,
	`title` text NOT NULL,
	`module_id` text DEFAULT 'black-oak-will' NOT NULL,
	`ruleset_version` text DEFAULT 'dnd5e-2014-srd5.1-authoritative-v2' NOT NULL,
	`kp_model` text DEFAULT 'deepseek-v4-flash' NOT NULL,
	`kp_model_profile` text DEFAULT 'authoritative-kp-deepseek-v4-flash-private-tools-v1' NOT NULL,
	`kp_workflow_manifest` text,
	`kp_context_planner_profile` text,
	`runtime_epoch_id` text,
	`genesis_hash` text,
	`status` text DEFAULT 'lobby' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_rooms`("id", "code", "host_user_id", "title", "module_id", "ruleset_version", "kp_model", "kp_model_profile", "kp_workflow_manifest", "kp_context_planner_profile", "runtime_epoch_id", "genesis_hash", "status", "created_at") SELECT "id", "code", "host_user_id", "title", "module_id", "ruleset_version", "kp_model", "kp_model_profile", "kp_workflow_manifest", "kp_context_planner_profile", "runtime_epoch_id", "genesis_hash", "status", "created_at" FROM `rooms`;--> statement-breakpoint
DROP TABLE `rooms`;--> statement-breakpoint
ALTER TABLE `__new_rooms` RENAME TO `rooms`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rooms_code` ON `rooms` (`code`);--> statement-breakpoint
CREATE INDEX `idx_rooms_host` ON `rooms` (`host_user_id`);