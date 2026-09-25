-- Whether the timer's entry rows are compact, so more of them fit on the screen. Off by default.
ALTER TABLE user_settings ADD COLUMN compact_rows integer DEFAULT 0 NOT NULL
  CONSTRAINT user_settings_compact_rows CHECK (compact_rows IN (0, 1));
