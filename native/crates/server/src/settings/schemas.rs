use crate::calendar::{WeekStart, Zone};
use crate::schemas::*;

pub const COLLECTIONS: &[&str] = &["mountains", "countryside", "coast"];
pub const IMAGES: &[&str] = &[
    "winter",
    "spring",
    "summer",
    "autumn",
    "land-january",
    "land-february",
    "land-march",
    "land-april",
    "land-may",
    "land-june",
    "land-july",
    "land-august",
    "land-september",
    "land-october",
    "land-november",
    "land-december",
    "coast-january",
    "coast-february",
    "coast-march",
    "coast-april",
    "coast-may",
    "coast-june",
    "coast-july",
    "coast-august",
    "coast-september",
    "coast-october",
    "coast-november",
    "coast-december",
];
const LOCALES: &[&str] = &["en", "et"];

fn time_zone(name: &str) -> Result<()> {
    let valid = name.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
        && name.split('/').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_+-".contains(&b))
        });
    if !valid {
        return invalid("Use a time zone such as Europe/Tallinn.");
    }
    // ICU rejects tzdb's placeholder Factory zone, which jiff can read.
    if name.eq_ignore_ascii_case("Factory") || Zone::get(name).is_none() {
        return invalid("Unknown time zone.");
    }
    Ok(())
}

// validDurationPattern (src/lib/duration-pattern-settings.ts): at most 40 UTF-16 units, with
// H, M, or S outside a backslash escape.
fn copy_duration_pattern(pattern: &str) -> Result<()> {
    let mut chars = pattern.chars();
    let mut field = false;
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                chars.next();
            }
            'H' | 'M' | 'S' => field = true,
            _ => {}
        }
    }
    if !field || pattern.encode_utf16().count() > 40 {
        return invalid("Use H, M, or S, in at most 40 characters.");
    }
    Ok(())
}

fn default_locale() -> String {
    "en".into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSettingsInput {
    pub time_zone: String,
    #[serde(default = "default_locale")]
    pub locale: String,
}
impl Validate for CreateSettingsInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        (
            "timeZone",
            Field::CheckedString {
                required: true,
                check: time_zone,
            },
        ),
        ("locale", Field::Picklist(LOCALES)),
    ];
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UpdateSettingsInput {
    pub time_zone: Option<String>,
    pub week_start: Option<String>,
    pub locale: Option<String>,
    pub theme: Option<String>,
    pub timer_layout: Option<String>,
    #[serde(deserialize_with = "optional_bool")]
    pub show_summary: Option<bool>,
    #[serde(deserialize_with = "optional_bool")]
    pub compact_rows: Option<bool>,
    #[serde(deserialize_with = "optional_bool")]
    pub wide_timer: Option<bool>,
    pub timer_view: Option<String>,
    #[serde(deserialize_with = "optional_bool")]
    pub calendar_weekend: Option<bool>,
    pub app_icon: Option<String>,
    pub scene_collection: Option<String>,
    pub scene_pin: Patch<String>,
    #[serde(deserialize_with = "optional_bool")]
    pub scene_background: Option<bool>,
    pub scene_strength: Option<String>,
    pub surfaces: Option<String>,
    #[serde(deserialize_with = "optional_bool")]
    pub scene_weather: Option<bool>,
    #[serde(deserialize_with = "optional_bool")]
    pub scene_intro: Option<bool>,
    #[serde(deserialize_with = "optional_bool")]
    pub scene_tagline: Option<bool>,
    pub duration_format: Option<String>,
    pub date_format: Option<String>,
    pub time_format: Option<String>,
    pub copy_duration_pattern: Option<String>,
    pub copy_duration_control: Option<String>,
    pub country: Patch<String>,
}
impl Validate for UpdateSettingsInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        (
            "timeZone",
            Field::CheckedString {
                required: false,
                check: time_zone,
            },
        ),
        ("weekStart", Field::Picklist(&["mon", "sun"])),
        ("locale", Field::Picklist(LOCALES)),
        ("theme", Field::Picklist(&["system", "light", "dark"])),
        ("timerLayout", Field::Picklist(&["bar", "focus", "table"])),
        ("showSummary", Field::Bool),
        ("compactRows", Field::Bool),
        ("wideTimer", Field::Bool),
        ("timerView", Field::Picklist(&["list", "calendar"])),
        ("calendarWeekend", Field::Bool),
        (
            "appIcon",
            Field::Picklist(&[
                "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12",
            ]),
        ),
        ("sceneCollection", Field::Picklist(COLLECTIONS)),
        ("scenePin", Field::NullablePicklist(IMAGES)),
        ("sceneBackground", Field::Bool),
        ("sceneStrength", Field::Picklist(&["dimmed", "full"])),
        ("surfaces", Field::Picklist(&["glass", "solid"])),
        ("sceneWeather", Field::Bool),
        ("sceneIntro", Field::Bool),
        ("sceneTagline", Field::Bool),
        ("durationFormat", Field::Picklist(&["clock", "units"])),
        ("dateFormat", Field::Picklist(&["dmy", "mdy"])),
        ("timeFormat", Field::Picklist(&["24h", "12h"])),
        (
            "copyDurationPattern",
            Field::CheckedString {
                required: false,
                check: copy_duration_pattern,
            },
        ),
        ("copyDurationControl", Field::Picklist(&["text", "button"])),
        ("country", Field::NullablePicklist(&["EE", "US", "other"])),
    ];
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn field_checks_keep_valibots_order_and_boolean_revival() {
        let result = decode::<UpdateSettingsInput>(
            json!({"country": "FI", "locale": "bad", "timeZone": "Mars/Olympus"}),
        );
        assert!(matches!(result, Err(Error::Invalid(message)) if message == "Unknown time zone."));
        let patch: UpdateSettingsInput = decode(json!({"showSummary": "false", "sceneWeather": "true", "scenePin": null, "country": null})).unwrap();
        assert_eq!(patch.show_summary, Some(false));
        assert_eq!(patch.scene_weather, Some(true));
        assert_eq!(patch.scene_pin, Patch::Null);
        assert_eq!(patch.country, Patch::Null);
        assert!(decode::<UpdateSettingsInput>(json!({"showSummary": null})).is_err());
    }

    #[test]
    fn copy_patterns_need_a_field_outside_escapes_in_40_utf16_units() {
        let long = format!("H{}", " ".repeat(39));
        for pattern in ["H:MM:SS", "Hh Mm Ss", "S", "\\HH", "H\\", long.as_str()] {
            assert!(decode::<UpdateSettingsInput>(json!({"copyDurationPattern": pattern})).is_ok());
        }
        let too_long = format!("H{}", " ".repeat(40));
        // 41 UTF-16 units in 21 chars.
        let astral = format!("H{}", "😀".repeat(20));
        for pattern in ["", "hms", "\\H", too_long.as_str(), astral.as_str()] {
            let result = decode::<UpdateSettingsInput>(json!({"copyDurationPattern": pattern}));
            assert!(
                matches!(result, Err(Error::Invalid(message)) if message == "Use H, M, or S, in at most 40 characters."),
                "{pattern}"
            );
        }
        for control in [json!("icon"), json!(""), json!(null)] {
            assert!(
                decode::<UpdateSettingsInput>(json!({"copyDurationControl": control})).is_err()
            );
        }
    }

    #[test]
    fn zones_keep_aliases_and_refuse_offsets_and_the_placeholder_zone() {
        for name in [
            "UTC",
            "utc",
            "US/Eastern",
            "Etc/GMT+2",
            "America/Argentina/Buenos_Aires",
        ] {
            assert!(decode::<CreateSettingsInput>(json!({"timeZone": name})).is_ok());
        }
        for name in [
            "+02:00",
            "",
            "Factory",
            "factory",
            "Z",
            "Mars/Olympus",
            "UTC\n",
        ] {
            assert!(decode::<CreateSettingsInput>(json!({"timeZone": name})).is_err());
        }
    }
}

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
    pub copy_duration_pattern: String,
    pub copy_duration_control: String,
    pub country: Option<String>,
}
