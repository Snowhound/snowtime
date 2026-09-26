-- Whether signed-in pages show the season's tagline by the page title.
ALTER TABLE user_settings ADD COLUMN scene_tagline integer DEFAULT 1 NOT NULL
  CONSTRAINT user_settings_scene_tagline CHECK (scene_tagline IN (0, 1));
