-- Product 0.4 intentionally retires every earlier development room. Clear the
-- complete D1 directory and rebuild archive before any 0.4 room can be made.
-- This is a one-way data reset; no current interpreter may guess old bindings.
DELETE FROM `authoritative_projection_audit_archive`;--> statement-breakpoint
DELETE FROM `authoritative_room_archive_checkpoint`;--> statement-breakpoint
DELETE FROM `authoritative_room_event_archive`;--> statement-breakpoint
DELETE FROM `authoritative_room_genesis_archive`;--> statement-breakpoint
DELETE FROM `characters`;--> statement-breakpoint
DELETE FROM `room_members`;--> statement-breakpoint
DELETE FROM `rooms`;
