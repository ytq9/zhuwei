-- The static corpus tables are a rebuildable projection. Clear every legacy
-- row so pre-v1.1 bodies, KP-only refs/aliases/search terms, and unscoped FTS
-- keys cannot survive the privacy + corpus-namespace format transition.
DELETE FROM `kp_static_chunks_fts`;--> statement-breakpoint
DELETE FROM `kp_static_chunks`;--> statement-breakpoint
DELETE FROM `kp_static_corpus_profiles`;
