-- The pattern a copied duration is formatted with (task 078). Like the other view settings,
-- the app validates the text value.
ALTER TABLE user_settings ADD COLUMN copy_duration_pattern text DEFAULT 'H:MM:SS' NOT NULL;
