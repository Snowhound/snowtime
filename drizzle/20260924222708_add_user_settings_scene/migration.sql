-- The seasonal scene behind the sign-in page and the app (task 033): the season ('auto' follows
-- the month), the background with its strength and the cards' surfaces, the weather, and the
-- intro. Like the other view settings, the app validates the text values and the booleans keep
-- the usual 0/1 CHECK.
ALTER TABLE user_settings ADD COLUMN scene_season text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN scene_background integer DEFAULT 1 NOT NULL
  CONSTRAINT user_settings_scene_background CHECK (scene_background IN (0, 1));
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN scene_strength text DEFAULT 'dimmed' NOT NULL;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN surfaces text DEFAULT 'glass' NOT NULL;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN scene_weather integer DEFAULT 1 NOT NULL
  CONSTRAINT user_settings_scene_weather CHECK (scene_weather IN (0, 1));
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN scene_intro integer DEFAULT 1 NOT NULL
  CONSTRAINT user_settings_scene_intro CHECK (scene_intro IN (0, 1));
