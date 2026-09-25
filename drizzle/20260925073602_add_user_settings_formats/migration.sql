-- How durations, numeric dates, and clock times show. 'auto' follows the UI language.
ALTER TABLE user_settings ADD COLUMN duration_format text DEFAULT 'clock' NOT NULL;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN date_format text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN time_format text DEFAULT 'auto' NOT NULL;
