CREATE TABLE `join_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `join_requests_user_created_idx` ON `join_requests` (`user_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `join_requests_created_idx` ON `join_requests` (`created_at`);