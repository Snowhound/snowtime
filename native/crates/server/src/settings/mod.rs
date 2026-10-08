pub mod routes;
pub mod schemas;
// Per-user settings (src/server/settings/settings.server.ts).
use self::schemas::{CreateSettingsInput, Settings, UpdateSettingsInput};
use crate::queries::Assignments;
use crate::schemas::Patch;
use crate::{Code, Key, Result, refuse};
use rusqlite::{Connection, OptionalExtension};

pub fn find_settings(db: &Connection, user_id: &str) -> Result<Option<Settings>> {
    let settings = crate::sql!("select time_zone, week_start, locale, theme, timer_layout, show_summary, compact_rows, wide_timer, timer_view, calendar_weekend, app_icon, scene_collection, scene_pin, scene_background, scene_strength, surfaces, scene_weather, scene_intro, scene_tagline, duration_format, date_format, time_format, copy_duration_pattern, copy_duration_control, country from user_settings where user_id = ",
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
            copy_duration_pattern: row.get(22)?,
            copy_duration_control: row.get(23)?,
            country: row.get(24)?,
        })
    })
    .optional()?;
    Ok(settings)
}

pub fn create_settings(
    db: &Connection,
    user_id: &str,
    input: CreateSettingsInput,
) -> Result<Settings> {
    if let Some(existing) = find_settings(db, user_id)? {
        return Ok(existing);
    }
    let now = crate::clock::now();
    crate::sql!("insert into user_settings (user_id, time_zone, locale, created_at, created_by, updated_at, updated_by) values (", user_id, ", ", input.time_zone, ", ", input.locale, ", ", now, ", ", user_id, ", ", now, ", ", user_id, ") on conflict do nothing").execute(db)?;
    find_settings(db, user_id)?.map_or_else(|| refuse(Code::NotFound, Key::SettingsNotFound), Ok)
}

pub fn update_settings(
    db: &Connection,
    user_id: &str,
    mut input: UpdateSettingsInput,
) -> Result<Settings> {
    if input.scene_collection.is_some() && input.scene_pin == Patch::Absent {
        input.scene_pin = Patch::Null;
    }
    if let Patch::Value(pin) = &input.scene_pin {
        let collection = match &input.scene_collection {
            Some(collection) => collection.clone(),
            None => find_settings(db, user_id)?
                .map_or_else(|| "mountains".into(), |settings| settings.scene_collection),
        };
        let in_collection = match collection.as_str() {
            "mountains" => schemas::IMAGES[..4].contains(&pin.as_str()),
            "countryside" => schemas::IMAGES[4..16].contains(&pin.as_str()),
            "coast" => schemas::IMAGES[16..].contains(&pin.as_str()),
            _ => false,
        };
        if !in_collection {
            return refuse(Code::Invalid, Key::ScenePinNotInCollection);
        }
    }
    let mut assignments = Assignments::default();
    assignments.set_optional("time_zone", input.time_zone);
    assignments.set_optional("week_start", input.week_start);
    assignments.set_optional("locale", input.locale);
    assignments.set_optional("theme", input.theme);
    assignments.set_optional("timer_layout", input.timer_layout);
    assignments.set_optional("show_summary", input.show_summary);
    assignments.set_optional("compact_rows", input.compact_rows);
    assignments.set_optional("wide_timer", input.wide_timer);
    assignments.set_optional("timer_view", input.timer_view);
    assignments.set_optional("calendar_weekend", input.calendar_weekend);
    assignments.set_optional("app_icon", input.app_icon);
    assignments.set_optional("scene_collection", input.scene_collection);
    assignments.set("scene_pin", input.scene_pin);
    assignments.set_optional("scene_background", input.scene_background);
    assignments.set_optional("scene_strength", input.scene_strength);
    assignments.set_optional("surfaces", input.surfaces);
    assignments.set_optional("scene_weather", input.scene_weather);
    assignments.set_optional("scene_intro", input.scene_intro);
    assignments.set_optional("scene_tagline", input.scene_tagline);
    assignments.set_optional("duration_format", input.duration_format);
    assignments.set_optional("date_format", input.date_format);
    assignments.set_optional("time_format", input.time_format);
    assignments.set_optional("copy_duration_pattern", input.copy_duration_pattern);
    assignments.set_optional("copy_duration_control", input.copy_duration_control);
    assignments.set("country", input.country);
    let fields = assignments.finish();
    if !fields.text().is_empty() {
        crate::sql!(
            "update user_settings set ",
            fields,
            ", updated_at = ",
            crate::clock::now(),
            ", updated_by = ",
            user_id,
            " where user_id = ",
            user_id
        )
        .execute(db)?;
    }
    find_settings(db, user_id)?.map_or_else(|| refuse(Code::NotFound, Key::SettingsNotFound), Ok)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schemas::decode;
    use serde_json::{json, to_value};

    fn database() -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        crate::migrations::migrate(
            &mut db,
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../drizzle"),
        )
        .unwrap();
        db.execute_batch("insert into user (id, name, email, email_verified, created_at, updated_at) values ('alice', 'Alice', 'alice@example.com', 1, 0, 0), ('bob', 'Bob', 'bob@example.com', 1, 0, 0)").unwrap();
        db
    }
    fn create(db: &Connection, user: &str) -> Settings {
        create_settings(db, user, decode(json!({"timeZone": "UTC"})).unwrap()).unwrap()
    }

    #[test]
    fn first_put_sets_defaults_and_actor_and_later_puts_keep_the_row() {
        let db = database();
        let first = create(&db, "alice");
        assert_eq!(first.locale, "en");
        assert_eq!(first.scene_collection, "mountains");
        assert_eq!(first.scene_pin, None);
        assert_eq!(first.country, None);
        let second = create_settings(
            &db,
            "alice",
            decode(json!({"timeZone": "Asia/Tokyo", "locale": "et"})).unwrap(),
        )
        .unwrap();
        assert_eq!(to_value(first).unwrap(), to_value(second).unwrap());
        assert_eq!(
            db.query_row(
                "select created_by || '/' || updated_by from user_settings where user_id = 'alice'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "alice/alice"
        );
    }

    #[test]
    fn patches_keep_other_fields_and_users_and_refusals_keep_the_row() {
        let db = database();
        create(&db, "alice");
        let bob = to_value(create(&db, "bob")).unwrap();
        let pinned = update_settings(
            &db,
            "alice",
            decode(json!({"country": "US", "scenePin": "autumn"})).unwrap(),
        )
        .unwrap();
        assert_eq!(pinned.scene_pin.as_deref(), Some("autumn"));
        assert_eq!(pinned.country.as_deref(), Some("US"));
        let before = to_value(pinned).unwrap();
        assert!(matches!(
            update_settings(
                &db,
                "alice",
                decode(json!({"scenePin": "coast-june"})).unwrap()
            ),
            Err(crate::Error::App(crate::AppError {
                key: Key::ScenePinNotInCollection,
                ..
            }))
        ));
        assert_eq!(
            to_value(update_settings(&db, "alice", UpdateSettingsInput::default()).unwrap())
                .unwrap(),
            before
        );
        let changed = update_settings(
            &db,
            "alice",
            decode(json!({"sceneCollection": "coast"})).unwrap(),
        )
        .unwrap();
        assert_eq!(changed.scene_pin, None);
        assert_eq!(changed.country.as_deref(), Some("US"));
        assert_eq!(
            to_value(find_settings(&db, "bob").unwrap().unwrap()).unwrap(),
            bob
        );
        let cleared = update_settings(
            &db,
            "alice",
            decode(json!({"country": null, "scenePin": null})).unwrap(),
        )
        .unwrap();
        assert_eq!(cleared.country, None);
        assert_eq!(cleared.scene_pin, None);
    }

    #[test]
    fn pin_check_precedes_missing_settings_and_empty_patch_is_not_found() {
        let db = database();
        assert!(matches!(
            update_settings(
                &db,
                "alice",
                decode(json!({"scenePin": "coast-june"})).unwrap()
            ),
            Err(crate::Error::App(crate::AppError {
                key: Key::ScenePinNotInCollection,
                ..
            }))
        ));
        assert!(matches!(
            update_settings(&db, "alice", UpdateSettingsInput::default()),
            Err(crate::Error::App(crate::AppError {
                key: Key::SettingsNotFound,
                ..
            }))
        ));
    }
}
