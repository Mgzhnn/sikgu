PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_room_members` (
	`room_id` text NOT NULL,
	`user_email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`created_at` integer NOT NULL,
	`review_token` text,
	PRIMARY KEY(`room_id`, `user_email`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_room_members` (
	`room_id`,
	`user_email`,
	`display_name`,
	`role`,
	`status`,
	`created_at`
)
SELECT
	`room_id`,
	`user_email`,
	`display_name`,
	`role`,
	`status`,
	`created_at`
FROM `room_members`;
--> statement-breakpoint
DROP TABLE `room_members`;
--> statement-breakpoint
ALTER TABLE `__new_room_members` RENAME TO `room_members`;
--> statement-breakpoint
CREATE INDEX `room_members_user_idx` ON `room_members` (`user_email`,`status`);
--> statement-breakpoint
CREATE INDEX `room_members_room_status_idx` ON `room_members` (`room_id`,`status`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
