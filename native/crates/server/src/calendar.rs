//! Calendar math in a user's IANA time zone (src/lib/calendar.ts). Calendar days are `Day`s,
//! which travel as ISO dates such as 2026-03-29; instants are epoch milliseconds.
use crate::schemas::MAX_ENTRY_MS;
use crate::timestamp::{civil_from_days, days_from_civil, days_in_month};
use jiff::tz::TimeZone;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ValueRef};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

const DAY: i64 = 86_400_000;

/// A calendar day, as days since 1970-01-01.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Day(pub i64);

impl Day {
    pub fn from_civil(year: i64, month: i64, day: i64) -> Day {
        Day(days_from_civil(year, month, day))
    }

    /// An ISO date as valibot's isoDate reads it, on a day the month has.
    pub fn parse(text: &str) -> Option<Day> {
        let b = text.as_bytes();
        if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
            return None;
        }
        let number = |range: std::ops::Range<usize>| {
            b[range.clone()].iter().all(u8::is_ascii_digit).then(|| {
                b[range]
                    .iter()
                    .fold(0i64, |n, d| n * 10 + i64::from(d - b'0'))
            })
        };
        let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
        ((1..=12).contains(&month) && (1..=31).contains(&day))
            .then_some((year, month, day))
            .filter(|&(year, month, day)| day <= days_in_month(year, month))
            .map(|(year, month, day)| Day::from_civil(year, month, day))
    }

    /// Whether `text` has an ISO date's form, whether or not the month has the day.
    pub fn is_iso_form(text: &str) -> bool {
        let b = text.as_bytes();
        b.len() == 10
            && b[4] == b'-'
            && b[7] == b'-'
            && [0, 1, 2, 3, 5, 6, 8, 9]
                .iter()
                .all(|&i| b[i].is_ascii_digit())
            && matches!(&b[5..7], [b'0', b'1'..=b'9'] | [b'1', b'0'..=b'2'])
            && matches!(
                &b[8..10],
                [b'0', b'1'..=b'9'] | [b'1' | b'2', _] | [b'3', b'0' | b'1']
            )
    }

    pub fn civil(self) -> (i64, i64, i64) {
        civil_from_days(self.0)
    }

    pub fn add_days(self, days: i64) -> Day {
        Day(self.0 + days)
    }

    /// 0 for Sunday through 6 for Saturday, as Date.getUTCDay().
    pub fn weekday(self) -> i64 {
        (self.0 + 4).rem_euclid(7)
    }

    fn midnight(self) -> i64 {
        self.0 * DAY
    }
}

impl std::fmt::Display for Day {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (year, month, day) = self.civil();
        write!(f, "{year:04}-{month:02}-{day:02}")
    }
}

impl Serialize for Day {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Day {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = <std::borrow::Cow<'de, str>>::deserialize(deserializer)?;
        Day::parse(&text).ok_or_else(|| serde::de::Error::custom("Invalid date"))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WeekStart {
    Mon,
    Sun,
}

impl FromSql for WeekStart {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "mon" => Ok(WeekStart::Mon),
            "sun" => Ok(WeekStart::Sun),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

/// An IANA zone, read from a settings row. A name the zone database lacks fails the read.
#[derive(Clone, Debug)]
pub struct Zone {
    pub name: String,
    tz: TimeZone,
}

impl Zone {
    pub fn get(name: &str) -> Option<Zone> {
        Some(Zone {
            name: name.to_owned(),
            tz: TimeZone::get(name).ok()?,
        })
    }
}

impl FromSql for Zone {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let name = value.as_str()?;
        Zone::get(name).ok_or_else(|| FromSqlError::Other(format!("Unknown zone {name}").into()))
    }
}

impl Serialize for Zone {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.name)
    }
}

/// Milliseconds the zone is ahead of UTC at the instant.
pub fn offset_at(ms: i64, zone: &Zone) -> i64 {
    let at = jiff::Timestamp::from_millisecond(ms).expect("instants are within jiff's range");
    i64::from(zone.tz.to_offset(at).seconds()) * 1000
}

// The zone's wall-clock time at the instant, as epoch milliseconds of the same reading in UTC.
fn wall_clock(ms: i64, zone: &Zone) -> i64 {
    ms + offset_at(ms, zone)
}

/// The calendar day of the instant in the zone.
pub fn local_date(ms: i64, zone: &Zone) -> Day {
    Day(wall_clock(ms, zone).div_euclid(DAY))
}

/// The first day of the week holding the day.
pub fn start_of_week(day: Day, week_start: WeekStart) -> Day {
    let first = if week_start == WeekStart::Mon { 1 } else { 0 };
    day.add_days(-((day.weekday() - first + 7) % 7))
}

/// The first day of the day's month and of the next one.
pub fn month_dates(day: Day) -> (Day, Day) {
    let (year, month, _) = day.civil();
    let next = if month == 12 {
        Day::from_civil(year + 1, 1, 1)
    } else {
        Day::from_civil(year, month + 1, 1)
    };
    (Day::from_civil(year, month, 1), next)
}

// The distinct offsets that apply within a day either side of the instant.
fn nearby_offsets(ms: i64, zone: &Zone) -> Vec<i64> {
    let mut offsets = Vec::with_capacity(3);
    for d in [-DAY, 0, DAY] {
        let offset = offset_at(ms + d, zone);
        if !offsets.contains(&offset) {
            offsets.push(offset);
        }
    }
    offsets
}

/// The first instant of the day in the zone: local midnight, its first occurrence when
/// clocks fell back at midnight, or the moment clocks sprang forward past a skipped midnight.
pub fn start_of_day(day: Day, zone: &Zone) -> i64 {
    let midnight = day.midnight();
    let offsets = nearby_offsets(midnight, zone);
    let exact = offsets
        .iter()
        .map(|o| midnight - o)
        .filter(|&t| wall_clock(t, zone) == midnight)
        .min();
    if let Some(exact) = exact {
        return exact;
    }
    // Midnight fell in a gap: find the first instant whose wall clock is past it.
    let mut lo = midnight - offsets.iter().max().unwrap();
    let mut hi = midnight - offsets.iter().min().unwrap();
    while hi - lo > 1000 {
        let mid = lo + (hi - lo).div_euclid(2000) * 1000;
        if wall_clock(mid, zone) >= midnight {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    hi
}

#[derive(Clone, Copy, Debug)]
pub struct Range {
    pub from: i64,
    pub to: i64,
}

/// The days from `from` up to but not including `to`.
pub fn dates_between(from: Day, to: Day) -> impl Iterator<Item = Day> {
    (from.0..to.0.max(from.0)).map(Day)
}

/// [start, end) split at the zone's midnights into the time on each calendar day.
pub fn split_by_day(mut start: i64, end: i64, zone: &Zone) -> Vec<(Day, i64)> {
    let mut pieces = Vec::new();
    let mut day = local_date(start, zone);
    while start < end {
        let next = start_of_day(day.add_days(1), zone).min(end);
        if next > start {
            pieces.push((day, next - start));
        }
        start = start.max(next);
        day = day.add_days(1);
    }
    pieces
}

/// split_by_day for many spans within the days from `from` up to `to`, finding each day's
/// start once. A span reaching outside the days falls back to split_by_day.
pub struct DaySplitter<'a> {
    from: Day,
    starts: Vec<i64>,
    zone: &'a Zone,
}

impl<'a> DaySplitter<'a> {
    pub fn new(from: Day, to: Day, zone: &'a Zone) -> Self {
        let starts = dates_between(from, to.add_days(1))
            .map(|day| start_of_day(day, zone))
            .collect();
        DaySplitter { from, starts, zone }
    }

    pub fn split(&self, mut start: i64, end: i64) -> Vec<(Day, i64)> {
        let starts = &self.starts;
        if start < starts[0] || end > starts[starts.len() - 1] {
            return split_by_day(start, end, self.zone);
        }
        // The day holding start: starts[i] <= start < starts[i + 1].
        let mut i = starts.partition_point(|&s| s <= start).max(1) - 1;
        let mut pieces = Vec::new();
        while start < end {
            let next = starts[i + 1].min(end);
            pieces.push((self.from.add_days(i as i64), next - start));
            start = next;
            i += 1;
        }
        pieces
    }
}

/// How long a running entry has run at `now`, up to the longest an entry runs.
pub fn running_ms(started_at: i64, now: i64) -> i64 {
    now.min(started_at + MAX_ENTRY_MS) - started_at
}

/// The span an entry counts for: a running entry runs up to now, or up to the longest an
/// entry runs, and an entry is clipped to the range. None when nothing of it falls inside.
pub fn counted_span(
    started_at: i64,
    stopped_at: Option<i64>,
    range: Range,
    now: i64,
) -> Option<Range> {
    let from = started_at.max(range.from);
    let end = stopped_at.unwrap_or_else(|| started_at + running_ms(started_at, now));
    let to = end.min(range.to);
    (to > from).then_some(Range { from, to })
}

/// The month's `n`th weekday (0 for Sunday through 6 for Saturday), counting from its end
/// when `n` is negative.
pub fn nth_weekday(year: i64, month: i64, weekday: i64, n: i64) -> Day {
    if n > 0 {
        let first = Day::from_civil(year, month, 1);
        return first.add_days((weekday - first.weekday() + 7) % 7 + (n - 1) * 7);
    }
    let last = Day::from_civil(year, month, days_in_month(year, month));
    last.add_days(-((last.weekday() - weekday + 7) % 7) + (n + 1) * 7)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(text: &str) -> Day {
        Day::parse(text).unwrap()
    }

    #[test]
    fn starts_days_across_clock_changes() {
        let tallinn = Zone::get("Europe/Tallinn").unwrap();
        // Clocks spring forward at 03:00 local on 2026-03-29, so that day has 23 hours.
        let start = start_of_day(day("2026-03-29"), &tallinn);
        assert_eq!(crate::Timestamp(start).to_iso(), "2026-03-28T22:00:00.000Z");
        let pieces = split_by_day(start, start_of_day(day("2026-03-31"), &tallinn), &tallinn);
        assert_eq!(
            pieces,
            [
                (day("2026-03-29"), 23 * 3_600_000),
                (day("2026-03-30"), 24 * 3_600_000)
            ]
        );
        // Santiago skipped midnight on 2026-09-06; the day starts at 01:00.
        let santiago = Zone::get("America/Santiago").unwrap();
        let start = start_of_day(day("2026-09-06"), &santiago);
        assert_eq!(crate::Timestamp(start).to_iso(), "2026-09-06T04:00:00.000Z");
        let splitter = DaySplitter::new(day("2026-03-28"), day("2026-04-01"), &tallinn);
        assert_eq!(
            splitter.split(
                start_of_day(day("2026-03-29"), &tallinn),
                start_of_day(day("2026-03-31"), &tallinn)
            ),
            pieces
        );
    }

    #[test]
    fn reads_iso_dates_and_weekdays() {
        assert_eq!(day("2026-09-30").to_string(), "2026-09-30");
        assert_eq!(day("2026-09-30").weekday(), 3);
        assert!(Day::parse("2026-02-30").is_none());
        assert!(Day::is_iso_form("2026-02-30"));
        assert!(!Day::is_iso_form("2026-13-01"));
        assert_eq!(nth_weekday(2026, 11, 4, 4), day("2026-11-26"));
        assert_eq!(nth_weekday(2026, 5, 1, -1), day("2026-05-25"));
        assert_eq!(
            start_of_week(day("2026-09-30"), WeekStart::Mon),
            day("2026-09-28")
        );
        assert_eq!(
            start_of_week(day("2026-09-30"), WeekStart::Sun),
            day("2026-09-27")
        );
        assert_eq!(
            month_dates(day("2026-12-15")),
            (day("2026-12-01"), day("2027-01-01"))
        );
    }
}
