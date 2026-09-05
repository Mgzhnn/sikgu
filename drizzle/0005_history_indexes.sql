DROP INDEX `room_messages_room_created_idx`;--> statement-breakpoint
CREATE INDEX `room_messages_sender_created_idx` ON `room_messages` (`room_id`,`sender_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `room_messages_room_created_idx` ON `room_messages` (`room_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `rooms_status_created_idx` ON `rooms` (`status`,`created_at`,`id`);