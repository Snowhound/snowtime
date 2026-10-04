use crate::calendar::{WeekStart, Zone};
use crate::schemas::*;

// The user's settings as the API sends them. The text values were checked when written.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub time_zone: Zone,
    pub week_start: WeekStart,
    pub locale: String,
    pub theme: String,
    pub timer_layout: String,
    pub show_summary: bool,
    pub compact_rows: bool,
    pub wide_timer: bool,
    pub timer_view: String,
    pub calendar_weekend: bool,
    pub app_icon: String,
    pub scene_collection: String,
    pub scene_pin: Option<String>,
    pub scene_background: bool,
    pub scene_strength: String,
    pub surfaces: String,
    pub scene_weather: bool,
    pub scene_intro: bool,
    pub scene_tagline: bool,
    pub duration_format: String,
    pub date_format: String,
    pub time_format: String,
    pub country: Option<String>,
}
