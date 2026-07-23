ALTER TABLE `rooms` ADD `estimated_arrival` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `order_total` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `receipt_key` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `receipt_content_type` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `receipt_uploaded_at` integer;--> statement-breakpoint
DELETE FROM `room_messages`;--> statement-breakpoint
DELETE FROM `room_invites`;--> statement-breakpoint
DELETE FROM `room_members`;--> statement-breakpoint
DELETE FROM `rooms`;
