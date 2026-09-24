-- The user's app icon (task 033): one of the brand concepts '01' to '12' in src/lib/app-icon.ts,
-- shown in the header and as the favicon. '02', Hound Hour, is the default. Like the other view
-- settings, the app validates the value; no CHECK, so a new concept needs no table rebuild.
ALTER TABLE user_settings ADD COLUMN app_icon text DEFAULT '02' NOT NULL;
