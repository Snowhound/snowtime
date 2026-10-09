//! A moment in milliseconds since the epoch, as the schema's timestamp_ms columns store it.
//! It travels as an ISO 8601 string, as `Date.toJSON` writes one and valibot's revived
//! `v.date()` reads one (src/lib/api/wire.ts).
use rusqlite::types::{FromSql, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Timestamp(pub i64);

const DAY_MS: i64 = 86_400_000;

// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's algorithm).
pub(crate) fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub(crate) fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

pub(crate) fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 31,
    }
}

impl Timestamp {
    /// `Date.toISOString()`: 2026-09-30T07:30:00.000Z.
    pub fn to_iso(self) -> String {
        let days = self.0.div_euclid(DAY_MS);
        let ms = self.0.rem_euclid(DAY_MS);
        let (year, month, day) = civil_from_days(days);
        format!(
            "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
            ms / 3_600_000,
            ms / 60_000 % 60,
            ms / 1000 % 60,
            ms % 1000
        )
    }

    /// The ISO 8601 forms `new Date(string)` reads: a date, or a date and time with
    /// optional seconds and fraction and a `Z` or `±hh:mm` offset. A time without an offset
    /// is read as UTC, where `Date` would read local time.
    pub fn parse(text: &str) -> Option<Timestamp> {
        // V8 accepts short numeric strings as a local month (1–12) or a year.
        // GET query values are strings even when the client input was numeric.
        if !text.is_empty() && text.len() < 4 && text.bytes().all(|b| b.is_ascii_digit()) {
            let n: i32 = text.parse().ok()?;
            let (year, month) = match n {
                0 => (2000, 1),
                1..=12 => (2001, n),
                13..=31 => return None,
                32..=49 => (2000 + n, 1),
                50..=99 => (1900 + n, 1),
                _ => (n, 1),
            };
            // SAFETY: tm is a C record whose fields are all valid when zeroed.
            let mut date: libc::tm = unsafe { std::mem::zeroed() };
            date.tm_year = year - 1900;
            date.tm_mon = month - 1;
            date.tm_mday = 1;
            date.tm_isdst = -1;
            // SAFETY: mktime borrows the record for this call only.
            let seconds = unsafe { libc::mktime(&mut date) };
            return Some(Timestamp(seconds as i64 * 1000));
        }
        let b = text.as_bytes();
        let digits = |from: usize, len: usize| -> Option<i64> {
            let part = b.get(from..from + len)?;
            part.iter()
                .all(u8::is_ascii_digit)
                .then(|| part.iter().fold(0i64, |n, d| n * 10 + i64::from(d - b'0')))
        };
        let year = digits(0, 4)?;
        if b.get(4) != Some(&b'-') || b.get(7) != Some(&b'-') {
            return None;
        }
        let (month, day) = (digits(5, 2)?, digits(8, 2)?);
        if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
            return None;
        }
        let mut ms = days_from_civil(year, month, day) * DAY_MS;
        if b.len() == 10 {
            return Some(Timestamp(ms));
        }
        if b.get(10) != Some(&b'T') || b.get(13) != Some(&b':') {
            return None;
        }
        let (hour, minute) = (digits(11, 2)?, digits(14, 2)?);
        let mut i = 16;
        let mut second = 0;
        if b.get(i) == Some(&b':') {
            second = digits(i + 1, 2)?;
            i += 3;
            if b.get(i) == Some(&b'.') {
                let start = i + 1;
                let mut end = start;
                while end < b.len() && b[end].is_ascii_digit() {
                    end += 1;
                }
                if end == start {
                    return None;
                }
                // Milliseconds; further digits are dropped, as V8 drops them.
                let frac = &b[start..end.min(start + 3)];
                let value = frac.iter().fold(0i64, |n, d| n * 10 + i64::from(d - b'0'));
                ms += value * 10i64.pow(3 - frac.len() as u32);
                i = end;
            }
        }
        if hour > 24 || minute > 59 || second > 59 || (hour == 24 && minute + second > 0) {
            return None;
        }
        ms += hour * 3_600_000 + minute * 60_000 + second * 1000;
        match b.get(i) {
            None => {}
            Some(b'Z') if i + 1 == b.len() => {}
            Some(&sign @ (b'+' | b'-')) if b.len() == i + 6 && b[i + 3] == b':' => {
                let offset = digits(i + 1, 2)? * 3_600_000 + digits(i + 4, 2)? * 60_000;
                ms += if sign == b'+' { -offset } else { offset };
            }
            _ => return None,
        }
        Some(Timestamp(ms))
    }
}

impl Serialize for Timestamp {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_iso())
    }
}

impl<'de> Deserialize<'de> for Timestamp {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = <std::borrow::Cow<'de, str>>::deserialize(deserializer)?;
        Timestamp::parse(&text).ok_or_else(|| serde::de::Error::custom("Invalid date"))
    }
}

impl ToSql for Timestamp {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        self.0.to_sql()
    }
}

// The app writes integers, but a REAL in the column reads as Drizzle reads it: `new Date`
// truncates it toward zero. perf/stress/dataset.ts writes some.
impl FromSql for Timestamp {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value {
            ValueRef::Real(ms) => Ok(Timestamp(ms.trunc() as i64)),
            _ => i64::column_result(value).map(Timestamp),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Timestamp;

    #[test]
    fn round_trips() {
        let seed = Timestamp::parse("2026-09-30T07:30:00.000Z").unwrap();
        assert_eq!(seed.0, 1_790_753_400_000);
        assert_eq!(seed.to_iso(), "2026-09-30T07:30:00.000Z");
        assert_eq!(Timestamp(0).to_iso(), "1970-01-01T00:00:00.000Z");
        assert_eq!(Timestamp(-1).to_iso(), "1969-12-31T23:59:59.999Z");
    }

    #[test]
    fn reads_what_date_reads() {
        assert_eq!(
            Timestamp::parse("2026-09-30").unwrap().to_iso(),
            "2026-09-30T00:00:00.000Z"
        );
        assert_eq!(
            Timestamp::parse("2026-09-30T10:30+03:00").unwrap().to_iso(),
            "2026-09-30T07:30:00.000Z"
        );
        assert_eq!(
            Timestamp::parse("2026-09-30T07:30:00.12345Z")
                .unwrap()
                .to_iso(),
            "2026-09-30T07:30:00.123Z"
        );
        assert!(Timestamp::parse("2026-02-30T00:00:00Z").is_none());
        assert!(Timestamp::parse("yesterday").is_none());
    }
}
