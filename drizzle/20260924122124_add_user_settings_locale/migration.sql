-- The user's UI language (task 018). The app validates it against its supported languages;
-- no CHECK, because adding a language would then need a table rebuild.
ALTER TABLE user_settings ADD COLUMN locale text DEFAULT 'en' NOT NULL;
