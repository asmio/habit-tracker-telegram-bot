CREATE TABLE `reminders` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`time` text NOT NULL,
	`last_sent_date` text,
	FOREIGN KEY (`item_id`) REFERENCES `tracker_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reminders_time_is_hh_mm" CHECK("reminders"."time" GLOB '[0-1][0-9]:[0-5][0-9]' OR "reminders"."time" GLOB '2[0-3]:[0-5][0-9]'),
	CONSTRAINT "reminders_last_sent_date_is_iso_date" CHECK("reminders"."last_sent_date" IS NULL OR date("reminders"."last_sent_date") IS "reminders"."last_sent_date")
);
