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

#[derive(Clone)]
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

pub fn breakdown_of(entries: &[ReportEntry], a: &Aggregation) -> super::schemas::ReportBreakdown {
    use super::schemas::{ProjectBreakdown, ReportBreakdown, TicketBreakdown};
    let mut projects: Vec<ProjectBreakdown> = Vec::new();
    let mut tickets: Vec<TicketBreakdown> = Vec::new();
    let mut project_indices = HashMap::new();
    let mut ticket_indices = HashMap::new();
    for entry in entries {
        let Some(span) = counted_span(entry.started_at, entry.stopped_at, a.range(), a.now) else {
            continue;
        };
        let ms = span.to - span.from;
        let key = (entry.project_id.clone(), entry.user_id.clone());
        let index = *project_indices.entry(key).or_insert_with(|| {
            projects.push(ProjectBreakdown {
                project_id: entry.project_id.clone(),
                user_id: entry.user_id.clone(),
                total: 0,
            });
            projects.len() - 1
        });
        projects[index].total += ms;
        if a.tickets {
            let key = (entry.ticket.clone(), entry.user_id.clone());
            let index = *ticket_indices.entry(key).or_insert_with(|| {
                tickets.push(TicketBreakdown {
                    ticket: entry.ticket.clone(),
                    user_id: entry.user_id.clone(),
                    total: 0,
                });
                tickets.len() - 1
            });
            tickets[index].total += ms;
        }
    }
    projects.sort_by(|x, y| {
        y.total
            .cmp(&x.total)
            .then_with(|| x.user_id.cmp(&y.user_id))
    });
    tickets.sort_by(|x, y| {
        y.total
            .cmp(&x.total)
            .then_with(|| x.user_id.cmp(&y.user_id))
    });
    ReportBreakdown { projects, tickets }
}

fn place_of(p: &super::schemas::ReportEntryPiece) -> super::schemas::DayCursor {
    super::schemas::DayCursor {
        date: p.date,
        user_id: p.user_id.clone(),
        from: p.from.0 as f64,
        entry_id: p.entry_id.clone(),
    }
}

fn by_day(a: &super::schemas::DayCursor, b: &super::schemas::DayCursor) -> std::cmp::Ordering {
    b.date
        .cmp(&a.date)
        .then_with(|| a.user_id.cmp(&b.user_id))
        .then_with(|| b.from.partial_cmp(&a.from).expect("finite cursor numbers"))
        .then_with(|| a.entry_id.cmp(&b.entry_id))
}

pub fn day_page(
    mut pieces: Vec<super::schemas::ReportEntryPiece>,
    after: Option<&super::schemas::DayCursor>,
) -> super::schemas::ReportEntries {
    use super::schemas::{DayTotal, ENTRY_PAGE_SIZE, ReportEntries};
    pieces.sort_by(|a, b| by_day(&place_of(a), &place_of(b)));
    let start = after.map_or(0, |after| {
        pieces
            .iter()
            .position(|p| by_day(&place_of(p), after).is_gt())
            .unwrap_or(pieces.len())
    });
    let mut end = (start + ENTRY_PAGE_SIZE).min(pieces.len());
    if end < pieces.len() {
        let mut cut = end;
        while cut > start && pieces[cut - 1].date == pieces[end].date {
            cut -= 1;
        }
        if cut > start {
            end = cut;
        }
    }
    let next = (end < pieces.len()).then(|| place_of(&pieces[end - 1]));
    let mut totals = HashMap::new();
    for p in &pieces {
        *totals.entry(p.date).or_insert(0) += p.ms;
    }
    let pieces: Vec<_> = pieces.into_iter().skip(start).take(end - start).collect();
    let mut days = Vec::new();
    for p in &pieces {
        if days.last().is_none_or(|d: &DayTotal| d.date != p.date) {
            days.push(DayTotal {
                date: p.date,
                total: totals[&p.date],
            });
        }
    }
    ReportEntries::Day { days, pieces, next }
}

// JavaScript's localeCompare uses Unicode collation, including case and punctuation.
fn compare_text(a: &str, b: &str) -> std::cmp::Ordering {
    static COLLATOR: std::sync::OnceLock<icu_collator::CollatorBorrowed<'static>> =
        std::sync::OnceLock::new();
    COLLATOR
        .get_or_init(|| {
            icu_collator::Collator::try_new(
                icu_locale_core::locale!("en-US").into(),
                Default::default(),
            )
            .expect("compiled en-US collation")
        })
        .compare(a, b)
}

pub fn merge_by_description(
    pieces: &[super::schemas::ReportEntryPiece],
) -> Vec<super::schemas::DescriptionRow> {
    use super::schemas::DescriptionRow;
    struct Merged {
        row: DescriptionRow,
        entries: HashSet<String>,
        days: HashSet<Day>,
    }
    let mut rows: Vec<Merged> = Vec::new();
    let mut indices = HashMap::new();
    for p in pieces {
        let key = (
            p.project_id.clone(),
            p.ticket.clone(),
            p.description.clone(),
        );
        let index = *indices.entry(key).or_insert_with(|| {
            rows.push(Merged {
                row: DescriptionRow {
                    project_id: p.project_id.clone(),
                    ticket: p.ticket.clone(),
                    description: p.description.clone(),
                    total: 0,
                    entries: 0,
                    days: 0,
                    user_ids: Vec::new(),
                },
                entries: HashSet::new(),
                days: HashSet::new(),
            });
            rows.len() - 1
        });
        let r = &mut rows[index];
        r.row.total += p.ms;
        r.entries.insert(p.entry_id.clone());
        r.days.insert(p.date);
        if !r.row.user_ids.contains(&p.user_id) {
            r.row.user_ids.push(p.user_id.clone());
        }
    }
    let mut rows: Vec<_> = rows
        .into_iter()
        .map(|mut r| {
            r.row.entries = r.entries.len();
            r.row.days = r.days.len();
            r.row
        })
        .collect();
    rows.sort_by(|a, b| {
        b.total
            .cmp(&a.total)
            .then_with(|| compare_text(&a.description, &b.description))
            .then_with(|| {
                compare_text(
                    a.ticket.as_deref().unwrap_or(""),
                    b.ticket.as_deref().unwrap_or(""),
                )
            })
            .then_with(|| {
                compare_text(
                    a.project_id.as_deref().unwrap_or(""),
                    b.project_id.as_deref().unwrap_or(""),
                )
            })
    });
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::super::schemas::{ReportEntries, ReportEntryPiece};
    use crate::schemas::Timestamp;

    fn piece(id: usize, date: &str, user: &str, from: i64, ms: i64) -> ReportEntryPiece {
        ReportEntryPiece {
            entry_id: format!("{id:04}"),
            user_id: user.into(),
            project_id: None,
            description: "Work".into(),
            ticket: None,
            date: Day::parse(date).unwrap(),
            from: Timestamp(from),
            to: Timestamp(from + ms),
            started_at: Timestamp(from),
            stopped_at: Some(Timestamp(from + ms)),
            running: false,
            ms,
        }
    }

    #[test]
    fn day_pages_end_on_whole_days_when_multiple_days_fit() {
        let pieces: Vec<_> = (0..120)
            .map(|i| {
                piece(
                    i,
                    if i < 40 { "2026-09-22" } else { "2026-09-21" },
                    "a",
                    i as i64,
                    10,
                )
            })
            .collect();
        let ReportEntries::Day {
            days,
            pieces: first,
            next,
        } = day_page(pieces.clone(), None)
        else {
            panic!("day view");
        };
        assert_eq!(first.len(), 40);
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].total, 400);
        assert_eq!(days[0].date, Day::parse("2026-09-22").unwrap());
        let ReportEntries::Day {
            days,
            pieces: second,
            next,
        } = day_page(pieces, next.as_ref())
        else {
            panic!("day view");
        };
        assert_eq!(second.len(), 80);
        assert_eq!(days[0].total, 800);
        assert!(next.is_none());
    }

    #[test]
    fn busy_day_pages_keep_whole_day_totals_and_cursor_order_without_duplicates() {
        let pieces: Vec<_> = (0..230)
            .map(|i| {
                piece(
                    i,
                    "2026-09-21",
                    if i % 2 == 0 { "a" } else { "b" },
                    (i / 2) as i64,
                    10,
                )
            })
            .collect();
        let mut after = None;
        let mut seen = HashSet::new();
        for length in [100, 100, 30] {
            let ReportEntries::Day {
                days,
                pieces: page,
                next,
            } = day_page(pieces.clone(), after.as_ref())
            else {
                panic!("day view");
            };
            assert_eq!(page.len(), length);
            assert_eq!(days.len(), 1);
            assert_eq!(days[0].total, 2300);
            for p in &page {
                assert!(seen.insert(p.entry_id.clone()));
            }
            for adjacent in page.windows(2) {
                assert!(by_day(&place_of(&adjacent[0]), &place_of(&adjacent[1])).is_lt());
            }
            after = next;
        }
        assert_eq!(seen.len(), 230);
        assert!(after.is_none());
        let after = super::super::schemas::DayCursor {
            date: Day::parse("2026-09-20").unwrap(),
            user_id: "a".into(),
            from: 0.5,
            entry_id: "0000".into(),
        };
        let ReportEntries::Day { days, pieces, next } = day_page(pieces, Some(&after)) else {
            panic!("day view");
        };
        assert!(days.is_empty() && pieces.is_empty() && next.is_none());
    }

    #[test]
    fn description_rows_count_distinct_entries_days_and_users_in_piece_order() {
        let mut pieces = vec![
            piece(1, "2026-09-21", "b", 0, 10),
            piece(1, "2026-09-22", "b", 10, 20),
            piece(2, "2026-09-22", "a", 30, 30),
            piece(3, "2026-09-22", "a", 60, 5),
        ];
        pieces[3].ticket = Some("LUM-1".into());
        let rows = merge_by_description(&pieces);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].total, 60);
        assert_eq!(rows[0].entries, 2);
        assert_eq!(rows[0].days, 2);
        assert_eq!(rows[0].user_ids, ["b", "a"]);
        assert_eq!(rows[1].ticket.as_deref(), Some("LUM-1"));
    }

    #[test]
    fn description_ties_use_collation_for_case_and_accents() {
        let pieces: Vec<_> = ["b", "Á", "A", "á", "a"]
            .into_iter()
            .enumerate()
            .map(|(i, description)| {
                let mut p = piece(i, "2026-09-21", "a", i as i64, 10);
                p.description = description.into();
                p
            })
            .collect();
        let rows = merge_by_description(&pieces);
        assert_eq!(
            rows.iter()
                .map(|r| r.description.as_str())
                .collect::<Vec<_>>(),
            ["a", "A", "á", "Á", "b"]
        );
    }

    #[test]
    fn breakdown_clips_spans_caps_running_time_and_preserves_ties() {
        let zone = Zone::get("UTC").unwrap();
        let from = Day::parse("2026-09-21").unwrap();
        let start = start_of_day(from, &zone);
        let a = Aggregation {
            zone,
            week_start: WeekStart::Mon,
            unit: Unit::Day,
            from,
            to: from.add_days(2),
            now: start + 2 * 86_400_000,
            teams: vec![],
            tickets: true,
        };
        let entries = vec![
            ReportEntry {
                user_id: "a".into(),
                project_id: Some("z".into()),
                ticket: Some("LUM-2".into()),
                started_at: start - 10,
                stopped_at: Some(start + 10),
            },
            ReportEntry {
                user_id: "a".into(),
                project_id: Some("a".into()),
                ticket: Some("LUM-1".into()),
                started_at: start,
                stopped_at: Some(start + 10),
            },
            ReportEntry {
                user_id: "b".into(),
                project_id: None,
                ticket: None,
                started_at: start + 20,
                stopped_at: None,
            },
            ReportEntry {
                user_id: "c".into(),
                project_id: None,
                ticket: None,
                started_at: start - 20,
                stopped_at: Some(start),
            },
        ];
        let breakdown = breakdown_of(&entries, &a);
        assert_eq!(breakdown.projects.len(), 3);
        assert_eq!(breakdown.projects[0].total, 86_400_000);
        assert_eq!(breakdown.projects[1].project_id.as_deref(), Some("z"));
        assert_eq!(breakdown.projects[2].project_id.as_deref(), Some("a"));
        assert_eq!(breakdown.projects[1].total, 10);
        assert_eq!(breakdown.tickets[1].ticket.as_deref(), Some("LUM-2"));
        let without_tickets = Aggregation {
            tickets: false,
            ..a
        };
        assert!(breakdown_of(&entries, &without_tickets).tickets.is_empty());
    }

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
