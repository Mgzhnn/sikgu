ALTER TABLE `room_members` ADD `amount` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `extensions` integer DEFAULT 0 NOT NULL;