-- The country whose working days count for the taglines: EE, US, or other. Null guesses it
-- from the time zone.
ALTER TABLE user_settings ADD COLUMN country text;
