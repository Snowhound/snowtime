//! The reports' pure part (src/server/reports/aggregation.server.ts): summing entries into
//! totals per day or week, project, ticket, team and member.
use super::schemas::{MemberRow, ProjectRow, TeamRow, TicketRow, Totals, Unit};
use crate::calendar::{
    Day, DaySplitter, Range, WeekStart, Zone, counted_span, start_of_day, start_of_week,
};
use std::collections::{HashMap, HashSet};

pub struct ReportEntry {
    pub user_id: String,
    pub project_id: Option<String>,
    pub ticket: Option<String>,
    pub started_at: i64,
    pub stopped_at: Option<i64>,
}

pub struct Aggregation {
    pub zone: Zone,
    pub week_start: WeekStart,
    pub unit: Unit,
    pub from: Day,
    pub to: Day,
    pub now: i64,
    // Current members of each team to total.
    pub teams: Vec<(String, Vec<String>)>,
    pub tickets: bool,
}

pub struct Aggregated {
    pub totals: Totals,
    pub buckets: Vec<Day>,
    pub tracked_days: usize,
    pub entries: usize,
    pub projects: Vec<ProjectRow>,
    pub tickets: Vec<TicketRow>,
    pub members: Vec<MemberRow>,
    pub teams: Vec<TeamRow>,
}

impl Aggregation {
    fn step(&self) -> i64 {
        if self.unit == Unit::Week { 7 } else { 1 }
    }

    fn buckets(&self) -> Vec<Day> {
        let mut day = match self.unit {
            Unit::Week => start_of_week(self.from, self.week_start),
            Unit::Day => self.from,
        };
        let mut buckets = Vec::new();
        while day < self.to {
            buckets.push(day);
            day = day.add_days(self.step());
        }
        buckets
    }

    pub fn range(&self) -> Range {
        Range {
            from: start_of_day(self.from, &self.zone),
            to: start_of_day(self.to, &self.zone),
        }
    }
}

// The rows with time, most time first, then by key as text (null as "null").
fn rows<K: Ord, R>(
    map: HashMap<K, Totals>,
    text: impl Fn(&K) -> &str,
    row: impl Fn(K, Totals) -> R,
) -> Vec<R> {
    let mut rows: Vec<_> = map.into_iter().filter(|(_, t)| t.total > 0).collect();
    rows.sort_by(|(x, a), (y, b)| b.total.cmp(&a.total).then_with(|| text(x).cmp(text(y))));
    rows.into_iter().map(|(k, t)| row(k, t)).collect()
}

fn or_null(key: &Option<String>) -> &str {
    key.as_deref().unwrap_or("null")
}

/// Sums the entries into the report's buckets and rows.
pub fn aggregate(entries: &[ReportEntry], a: &Aggregation) -> Aggregated {
    let buckets = a.buckets();
    let range = a.range();
    let split = DaySplitter::new(a.from, a.to, &a.zone);
    let first = buckets[0];
    let bucket_of = |day: Day| ((day.0 - first.0) / a.step()) as usize;
    let empty = || Totals {
        total: 0,
        per_bucket: vec![0; buckets.len()],
    };
    fn add(t: &mut Totals, bucket: usize, ms: i64) {
        t.total += ms;
        t.per_bucket[bucket] += ms;
    }

    let mut all = empty();
    let mut projects: HashMap<Option<String>, Totals> = HashMap::new();
    let mut tickets: HashMap<Option<String>, Totals> = HashMap::new();
    let mut members: HashMap<String, Totals> = HashMap::new();
    let mut days = HashSet::new();
    let mut counted = 0;
    for entry in entries {
        let Some(span) = counted_span(entry.started_at, entry.stopped_at, range, a.now) else {
            continue;
        };
        counted += 1;
        for (day, ms) in split.split(span.from, span.to) {
            let bucket = bucket_of(day);
            add(&mut all, bucket, ms);
            add(
                projects
                    .entry(entry.project_id.clone())
                    .or_insert_with(empty),
                bucket,
                ms,
            );
            if a.tickets {
                add(
                    tickets.entry(entry.ticket.clone()).or_insert_with(empty),
                    bucket,
                    ms,
                );
            }
            add(
                members.entry(entry.user_id.clone()).or_insert_with(empty),
                bucket,
                ms,
            );
            if ms > 0 {
                days.insert(day);
            }
        }
    }

    let mut teams = HashMap::new();
    for (team_id, user_ids) in &a.teams {
        let mut sum = empty();
        for m in user_ids.iter().filter_map(|id| members.get(id)) {
            sum.total += m.total;
            for (i, ms) in m.per_bucket.iter().enumerate() {
                sum.per_bucket[i] += ms;
            }
        }
        teams.insert(team_id.clone(), sum);
    }

    Aggregated {
        totals: all,
        tracked_days: days.len(),
        entries: counted,
        projects: rows(projects, or_null, |project_id, totals| ProjectRow {
            project_id,
            totals,
        }),
        tickets: rows(tickets, or_null, |ticket, totals| TicketRow {
            ticket,
            totals,
        }),
        members: rows(
            members,
            |id| id,
            |user_id, totals| MemberRow { user_id, totals },
        ),
        teams: rows(
            teams,
            |id| id,
            |team_id, totals| TeamRow { team_id, totals },
        ),
        buckets,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_entries_into_day_and_week_buckets() {
        let day = |text| Day::parse(text).unwrap();
        let zone = Zone::get("Europe/Tallinn").unwrap();
        let mut a = Aggregation {
            zone: zone.clone(),
            week_start: WeekStart::Mon,
            unit: Unit::Day,
            from: day("2026-09-28"),
            to: day("2026-10-05"),
            now: start_of_day(day("2026-10-01"), &zone),
            teams: vec![("team".into(), vec!["a".into(), "gone".into()])],
            tickets: true,
        };
        let hour = 3_600_000;
        // 22:00 to 02:00 local crosses midnight; the running entry counts up to now.
        let monday_22 = start_of_day(day("2026-09-28"), &zone) + 22 * hour;
        let entries = [
            ReportEntry {
                user_id: "a".into(),
                project_id: None,
                ticket: Some("LUM-1".into()),
                started_at: monday_22,
                stopped_at: Some(monday_22 + 4 * hour),
            },
            ReportEntry {
                user_id: "b".into(),
                project_id: Some("p".into()),
                ticket: None,
                started_at: a.now - hour,
                stopped_at: None,
            },
        ];
        let report = aggregate(&entries, &a);
        assert_eq!(report.totals.total, 5 * hour);
        assert_eq!(report.totals.per_bucket[..3], [2 * hour, 2 * hour, hour]);
        assert_eq!(report.tracked_days, 3);
        assert_eq!(report.projects[0].project_id, None);
        assert_eq!(report.teams[0].totals.total, 4 * hour);
        a.unit = Unit::Week;
        a.from = day("2026-09-30");
        let report = aggregate(&entries, &a);
        assert_eq!(report.buckets, [day("2026-09-28")]);
        assert_eq!(report.totals.total, hour);
    }
}
