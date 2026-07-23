CREATE TABLE `room_invites` (
	`token` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`created_by_email` text NOT NULL,
	`max_uses` integer NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `room_invites_room_idx` ON `room_invites` (`room_id`);--> statement-breakpoint
CREATE TABLE `room_members` (
	`room_id` text NOT NULL,
	`user_email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `user_email`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `room_members_user_idx` ON `room_members` (`user_email`,`status`);--> statement-breakpoint
CREATE INDEX `room_members_room_status_idx` ON `room_members` (`room_id`,`status`);--> statement-breakpoint
CREATE TABLE `room_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`sender_email` text NOT NULL,
	`sender_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `room_messages_room_created_idx` ON `room_messages` (`room_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`host_email` text NOT NULL,
	`host_name` text NOT NULL,
	`restaurant_id` text NOT NULL,
	`pickup` text NOT NULL,
	`pickup_full` text NOT NULL,
	`apps` text NOT NULL,
	`closes_at` integer NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`target` integer NOT NULL,
	`capacity` integer NOT NULL,
	`membership` text NOT NULL,
	`note` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_status_closes_idx` ON `rooms` (`status`,`closes_at`);--> statement-breakpoint
CREATE INDEX `rooms_host_idx` ON `rooms` (`host_email`);