-- Whether the Timer page is wide, up to 88rem, with the timer across the summary column and a
-- Ticket column in the rows. Off by default.
ALTER TABLE user_settings ADD COLUMN wide_timer integer DEFAULT 0 NOT NULL
  CONSTRAINT user_settings_wide_timer CHECK (wide_timer IN (0, 1));
