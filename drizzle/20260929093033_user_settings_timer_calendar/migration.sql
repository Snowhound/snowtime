-- The Timer page's view, the entry list or the week calendar (task 069), and whether the
-- calendar shows the weekend without time on it. Like the other view settings, the app
-- validates the text value.
ALTER TABLE user_settings ADD COLUMN timer_view text DEFAULT 'list' NOT NULL;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN calendar_weekend integer DEFAULT 0 NOT NULL
  CONSTRAINT user_settings_calendar_weekend CHECK (calendar_weekend IN (0, 1));
