-- How a duration is copied (task 078): a click on the duration itself, or a copy button
-- next to it. Like the other view settings, the app validates the text value.
ALTER TABLE user_settings ADD COLUMN copy_duration_control text DEFAULT 'text' NOT NULL;
