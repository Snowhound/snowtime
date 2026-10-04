//! Working days by region (src/lib/holidays/): Saturday and Sunday are never working days.
//! Estonia's days off and shortened days come from the app's ee.json; the US's follow rules;
//! other regions have weekends only.
use crate::calendar::{Day, nth_weekday};
use std::collections::HashSet;
use std::sync::OnceLock;

struct Estonia {
    off: HashSet<Day>,
    short: HashSet<Day>,
}

fn estonia() -> &'static Estonia {
    static DAYS: OnceLock<Estonia> = OnceLock::new();
    DAYS.get_or_init(|| {
        #[derive(serde::Deserialize)]
        struct Listed {
            date: String,
            kind: String,
        }
        let listed: Vec<Listed> =
            serde_json::from_str(include_str!("../../../../src/lib/holidays/ee.json"))
                .expect("ee.json lists dates");
        let days = |kind: &str| {
            listed
                .iter()
                .filter(|d| d.kind == kind)
                .map(|d| Day::parse(&d.date).expect("ee.json holds ISO dates"))
                .collect()
        };
        Estonia {
            off: days("off"),
            short: days("short"),
        }
    })
}

// A fixed date on a Saturday is observed on the Friday before, on a Sunday on the Monday after.
fn observed(day: Day) -> Day {
    match day.weekday() {
        6 => day.add_days(-1),
        0 => day.add_days(1),
        _ => day,
    }
}

// The working day before, skipping the weekend.
fn weekday_before(day: Day) -> Day {
    let mut day = day.add_days(-1);
    while matches!(day.weekday(), 0 | 6) {
        day = day.add_days(-1);
    }
    day
}

// The US days off observed for the year's holidays (src/lib/holidays/us.ts).
fn us_days_off(year: i64) -> [Day; 11] {
    let thanksgiving = nth_weekday(year, 11, 4, 4);
    let christmas = observed(Day::from_civil(year, 12, 25));
    [
        observed(Day::from_civil(year, 1, 1)),
        nth_weekday(year, 1, 1, 3),
        nth_weekday(year, 2, 1, 3),
        nth_weekday(year, 5, 1, -1),
        observed(Day::from_civil(year, 6, 19)),
        observed(Day::from_civil(year, 7, 4)),
        nth_weekday(year, 9, 1, 1),
        thanksgiving,
        thanksgiving.add_days(1),
        weekday_before(christmas),
        christmas,
    ]
}

fn is_day_off(day: Day, region: &str) -> bool {
    match region {
        "EE" => estonia().off.contains(&day),
        // New Year's Day on a Saturday is observed on 31 December of the year before.
        "US" => {
            let year = day.civil().0;
            us_days_off(year).contains(&day) || us_days_off(year + 1).contains(&day)
        }
        _ => false,
    }
}

pub fn is_working_day(day: Day, region: &str) -> bool {
    !matches!(day.weekday(), 0 | 6) && !is_day_off(day, region)
}

/// A working day with shorter hours by law, such as the day before Christmas Eve in Estonia.
pub fn is_short_day(day: Day, region: &str) -> bool {
    region == "EE" && estonia().short.contains(&day)
}

// The US's zones in tzdata with their aliases, without the territories (src/lib/holidays/region.ts).
const US_ZONES: &[&str] = &[
    "America/New_York",
    "US/Eastern",
    "EST5EDT",
    "America/Detroit",
    "US/Michigan",
    "America/Kentucky/Louisville",
    "America/Louisville",
    "America/Kentucky/Monticello",
    "America/Indiana/Indianapolis",
    "America/Indianapolis",
    "America/Fort_Wayne",
    "US/East-Indiana",
    "America/Indiana/Vincennes",
    "America/Indiana/Winamac",
    "America/Indiana/Marengo",
    "America/Indiana/Petersburg",
    "America/Indiana/Vevay",
    "America/Chicago",
    "US/Central",
    "CST6CDT",
    "America/Indiana/Tell_City",
    "America/Indiana/Knox",
    "America/Knox_IN",
    "US/Indiana-Starke",
    "America/Menominee",
    "America/North_Dakota/Center",
    "America/North_Dakota/New_Salem",
    "America/North_Dakota/Beulah",
    "America/Denver",
    "US/Mountain",
    "MST7MDT",
    "America/Shiprock",
    "Navajo",
    "America/Boise",
    "America/Phoenix",
    "US/Arizona",
    "MST",
    "America/Los_Angeles",
    "US/Pacific",
    "PST8PDT",
    "America/Anchorage",
    "US/Alaska",
    "America/Juneau",
    "America/Sitka",
    "America/Metlakatla",
    "America/Yakutat",
    "America/Nome",
    "America/Adak",
    "US/Aleutian",
    "America/Atka",
    "Pacific/Honolulu",
    "US/Hawaii",
    "Pacific/Johnston",
];

/// The region whose working days count for the user: the saved country, else a guess from
/// the time zone.
pub fn user_region<'a>(country: Option<&'a str>, time_zone: &str) -> &'a str {
    country.unwrap_or(match time_zone {
        "Europe/Tallinn" => "EE",
        zone if US_ZONES.contains(&zone) => "US",
        _ => "other",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_days_off() {
        let day = |text| Day::parse(text).unwrap();
        assert!(!is_working_day(day("2026-06-24"), "EE"));
        assert!(is_short_day(day("2026-06-22"), "EE"));
        assert!(!is_working_day(day("2026-11-27"), "US"));
        // 2027-01-01 is a Friday; 2022-01-01 a Saturday, observed on 2021-12-31.
        assert!(!is_working_day(day("2021-12-31"), "US"));
        assert!(is_working_day(day("2026-06-24"), "other"));
        assert_eq!(user_region(None, "America/Chicago"), "US");
        assert_eq!(user_region(Some("EE"), "America/Chicago"), "EE");
    }
}
