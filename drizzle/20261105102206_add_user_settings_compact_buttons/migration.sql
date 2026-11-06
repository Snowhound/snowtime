-- Whether the Timer page's header shows its buttons as icons, named by tooltips. Off by
-- default.
ALTER TABLE user_settings ADD COLUMN compact_buttons integer DEFAULT 0 NOT NULL
  CONSTRAINT user_settings_compact_buttons CHECK (compact_buttons IN (0, 1));
