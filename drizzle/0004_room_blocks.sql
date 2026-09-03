CREATE TABLE `room_blocks` (
	`room_id` text NOT NULL,
	`user_email` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `user_email`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
