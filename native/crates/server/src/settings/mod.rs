pub mod schemas;
// Per-user settings (src/server/settings/settings.server.ts). Only the reads that the session
// and the reports need are ported; the writes answer 404.
use self::schemas::Settings;
use crate::Result;
use rusqlite::{Connection, OptionalExtension};

pub fn find_settings(db: &Connection, user_id: &str) -> Result<Option<Settings>> {
    let settings = crate::sql!("select time_zone, week_start, locale, theme, timer_layout, show_summary, compact_rows, wide_timer, timer_view, calendar_weekend, app_icon, scene_collection, scene_pin, scene_background, scene_strength, surfaces, scene_weather, scene_intro, scene_tagline, duration_format, date_format, time_format, country from user_settings where user_id = ",
        user_id)
    .query_row(db, |row| {
        Ok(Settings {
            time_zone: row.get(0)?,
            week_start: row.get(1)?,
            locale: row.get(2)?,
            theme: row.get(3)?,
            timer_layout: row.get(4)?,
            show_summary: row.get(5)?,
            compact_rows: row.get(6)?,
            wide_timer: row.get(7)?,
            timer_view: row.get(8)?,
            calendar_weekend: row.get(9)?,
            app_icon: row.get(10)?,
            scene_collection: row.get(11)?,
            scene_pin: row.get(12)?,
            scene_background: row.get(13)?,
            scene_strength: row.get(14)?,
            surfaces: row.get(15)?,
            scene_weather: row.get(16)?,
            scene_intro: row.get(17)?,
            scene_tagline: row.get(18)?,
            duration_format: row.get(19)?,
            date_format: row.get(20)?,
            time_format: row.get(21)?,
            country: row.get(22)?,
        })
    })
    .optional()?;
    Ok(settings)
}
