//! The fill summary the timesheet taglines pick from (src/lib/taglines/fill.ts): how the
//! user's recent working days are filled, in their zone and region, across all their
//! organizations.
use crate::calendar::{
    Day, Range, WeekStart, Zone, counted_span, dates_between, local_date, month_dates,
    split_by_day, start_of_day, start_of_week,
};
use crate::holidays::{is_short_day, is_working_day};
use serde::Serialize;
use std::collections::HashMap;

// A working day counts as filled at this much logged time; a shortened one at 3 hours less.
const FILLED_MS: i64 = 6 * 3_600_000;
const SHORT_DAY_MS: i64 = 3 * 3_600_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FillSummary {
    pub date: Day,
    pub timer_started_at: Option<i64>,
    pub today: &'static str,
    pub last_working_day: Option<LastWorkingDay>,
    pub last_week: Option<bool>,
    pub last_month: Option<bool>,
    pub caught_up: bool,
    pub empty_days: usize,
    pub streak: usize,
}

#[derive(Serialize)]
pub struct LastWorkingDay {
    pub date: Day,
    pub filled: bool,
}

pub struct Options<'a> {
    pub now: i64,
    pub zone: &'a Zone,
    pub week_start: WeekStart,
    pub region: &'a str,
    // The day the account was created: days before it aren't expected.
    pub since: Day,
}

/// The span the summary reads entries from: the start of last month to now.
pub fn fill_range(now: i64, zone: &Zone) -> Range {
    let last_month = month_dates(month_dates(local_date(now, zone)).0.add_days(-1)).0;
    Range {
        from: start_of_day(last_month, zone),
        to: now,
    }
}

/// Entries as (started_at, stopped_at) in milliseconds.
pub fn fill_summary(entries: &[(i64, Option<i64>)], o: &Options) -> FillSummary {
    let range = fill_range(o.now, o.zone);
    let mut logged: HashMap<Day, i64> = HashMap::new();
    for &(started_at, stopped_at) in entries {
        let Some(span) = counted_span(started_at, stopped_at, range, o.now) else {
            continue;
        };
        for (day, ms) in split_by_day(span.from, span.to, o.zone) {
            *logged.entry(day).or_default() += ms;
        }
    }
    let expected = |day: Day| day >= o.since && is_working_day(day, o.region);
    let filled = |day: Day| {
        let needed = FILLED_MS
            - if is_short_day(day, o.region) {
                SHORT_DAY_MS
            } else {
                0
            };
        logged.get(&day).copied().unwrap_or(0) >= needed
    };
    // Every expected day is filled, or None when none is expected.
    let all_filled = |from: Day, to: Day| {
        let mut days = dates_between(from, to).filter(|&d| expected(d)).peekable();
        days.peek().is_some().then(|| days.all(filled))
    };

    let date = local_date(o.now, o.zone);
    // The expected days before today, newest first.
    let mut before: Vec<Day> = dates_between(local_date(range.from, o.zone), date)
        .filter(|&d| expected(d))
        .collect();
    before.reverse();
    let today = if !expected(date) {
        "off"
    } else if filled(date) {
        "filled"
    } else {
        "open"
    };
    let last_week_start = start_of_week(date, o.week_start).add_days(-7);
    let this_month = month_dates(date).0;
    let leading =
        |matches: &dyn Fn(Day) -> bool| before.iter().take_while(|&&d| matches(d)).count();
    FillSummary {
        date,
        timer_started_at: entries.iter().find(|e| e.1.is_none()).map(|e| e.0),
        today,
        last_working_day: before.first().map(|&d| LastWorkingDay {
            date: d,
            filled: filled(d),
        }),
        last_week: all_filled(last_week_start, last_week_start.add_days(7)),
        last_month: all_filled(month_dates(this_month.add_days(-1)).0, this_month),
        caught_up: before.iter().all(|&d| filled(d)),
        empty_days: leading(&|d| !logged.contains_key(&d)),
        streak: usize::from(today == "filled") + leading(&filled),
    }
}
