CREATE TABLE `user_sessions` (
	`telegram_id` integer PRIMARY KEY NOT NULL,
	`message_id` integer NOT NULL,
	`screen` text NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
