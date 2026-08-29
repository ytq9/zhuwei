ALTER TABLE `kp_static_chunks` ADD `corpus_profile_ref` text;--> statement-breakpoint
ALTER TABLE `kp_static_chunks` ADD `corpus_profile_hash` text;--> statement-breakpoint
ALTER TABLE `kp_static_chunks` ADD `corpus_hash` text;--> statement-breakpoint
ALTER TABLE `kp_static_chunks` ADD `structural_refs` text;--> statement-breakpoint
ALTER TABLE `kp_static_chunks` ADD `source_type` text;--> statement-breakpoint
ALTER TABLE `kp_static_corpus_profiles` ADD `corpus_hash` text;--> statement-breakpoint
ALTER TABLE `kp_static_corpus_profiles` ADD `compiler_version` text;