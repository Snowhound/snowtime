-- The user's UI language and view settings (task 018), kept on the server so they follow
-- the user across devices. The app validates the text values; no CHECK, because adding a
-- value would then need a table rebuild. show_summary is a boolean, so it keeps the usual
-- 0/1 CHECK.
ALTER TABLE user_settings ADD COLUMN locale text DEFAULT 'en' NOT NULL;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN theme text DEFAULT 'system' NOT NULL;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN timer_layout text DEFAULT 'bar' NOT NULL;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN show_summary integer DEFAULT 1 NOT NULL
  CONSTRAINT user_settings_show_summary CHECK (show_summary IN (0, 1));
