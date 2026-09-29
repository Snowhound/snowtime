-- The scene's image collection and pin (task 062) replace scene_season. A pinned season becomes
-- Mountain valley pinned to that season's image, which has the season's id; 'auto' becomes
-- Mountain valley following the calendar. scene_season stays, unread, for the app version still
-- running until the deploy is promoted, and a later migration drops it. Like the other view
-- settings, the app validates the text values.
ALTER TABLE user_settings ADD COLUMN scene_collection text DEFAULT 'mountains' NOT NULL;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN scene_pin text;
--> statement-breakpoint
UPDATE user_settings SET scene_pin = scene_season
WHERE scene_season IN ('winter', 'spring', 'summer', 'autumn');
