CREATE TABLE `kp_static_chunks` (
	`source_ref` text PRIMARY KEY NOT NULL,
	`source_hash` text NOT NULL,
	`source_span` text NOT NULL,
	`profile_ref` text NOT NULL,
	`sensitivity` text NOT NULL,
	`dependency_refs` text NOT NULL,
	`purpose` text NOT NULL,
	`body` text NOT NULL,
	`aliases` text NOT NULL,
	`search_text` text NOT NULL,
	`rebuilt_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_kp_static_chunks_profile` ON `kp_static_chunks` (`profile_ref`);--> statement-breakpoint
CREATE INDEX `idx_kp_static_chunks_hash` ON `kp_static_chunks` (`source_hash`);--> statement-breakpoint
CREATE TABLE `kp_static_corpus_profiles` (
	`profile_ref` text PRIMARY KEY NOT NULL,
	`profile_hash` text NOT NULL,
	`chunk_count` integer NOT NULL,
	`rebuilt_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `kp_static_chunks_fts` USING fts5(`source_ref` UNINDEXED, `search_text`, tokenize='unicode61');
--> statement-breakpoint
ALTER TABLE `rooms` ADD `kp_workflow_manifest` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `kp_context_planner_profile` text;
