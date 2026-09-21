CREATE TABLE `daily_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`date` text NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `tracker_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "daily_logs_date_is_iso_date" CHECK(date("daily_logs"."date") IS "daily_logs"."date"),
	CONSTRAINT "daily_logs_checked_is_boolean" CHECK("daily_logs"."checked" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_logs_item_id_date_unique` ON `daily_logs` (`item_id`,`date`);--> statement-breakpoint
CREATE TABLE `tracker_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tracker_id` integer NOT NULL,
	`label` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`tracker_id`) REFERENCES `trackers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trackers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`telegram_id`) REFERENCES `users`(`telegram_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_id` integer NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`timezone_confirmed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_id_unique` ON `users` (`telegram_id`);