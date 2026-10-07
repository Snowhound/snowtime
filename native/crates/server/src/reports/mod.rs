pub mod aggregation;
pub mod routes;
pub mod schemas;
// Reports: time totals per day or week, project, team and member, in the user's time zone
// (src/server/reports/reports.server.ts). Everyone reports on entries they may read; team totals
// count each team's current members.
use self::aggregation::{Aggregation, ReportEntry, aggregate};
use self::schemas::{
    DESCRIPTION_PAGE_SIZE, ENTRY_PAGE_SIZE, EntryRow, ExportEntry, FormerMember, Report,
    ReportBreakdown, ReportEntries, ReportEntriesInput, ReportEntryPiece, ReportEntryTotals,
    ReportEntryTotalsInput, ReportExport, ReportExportInput, ReportInput,
};
use crate::calendar::{
    DaySplitter, Range, WeekStart, Zone, counted_span, local_date, start_of_day,
};
use crate::queries::{Sql, list};
use crate::schemas::{MAX_ENTRY_MS, Timestamp};
use crate::scope::{Scope, is_admin, readable_user_ids};
use crate::{Code, Key, Result, clock, refuse};
use rusqlite::{Connection, OptionalExtension};
use std::collections::HashSet;

fn settings_of(db: &Connection, user_id: &str) -> Result<(Zone, WeekStart)> {
    let settings = crate::sql!(
        "select time_zone, week_start from user_settings where user_id = ",
        user_id
    )
    .query_row(db, |row| Ok((row.get(0)?, row.get(1)?)))
    .optional()?;
    settings.map_or_else(|| refuse(Code::NotFound, Key::SettingsNotFound), Ok)
}

// Teams the scope reports on (all for admins and owners, else those the user leads), with
// their current members, in one read.
fn report_teams(db: &Connection, scope: &Scope) -> Result<Vec<(String, Vec<String>)>> {
    if !is_admin(scope) && scope.led_team_ids.is_empty() {
        return Ok(vec![]);
    }
    let led = if is_admin(scope) {
        Sql::default()
    } else {
        crate::sql!(" and team.id in ", list(&scope.led_team_ids))
    };
    let rows = crate::sql!(
        "select team.id, team_member.user_id from team left join team_member on team_member.team_id = team.id where (team.organization_id = ",
        &scope.organization_id,
        led,
        ")"
    )
    .query(db, |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    })?;
    let mut teams: Vec<(String, Vec<String>)> = Vec::new();
    for (team_id, user_id) in rows {
        let index = match teams.iter().position(|(id, _)| *id == team_id) {
            Some(index) => index,
            None => {
                teams.push((team_id, vec![]));
                teams.len() - 1
            }
        };
        teams[index].1.extend(user_id);
    }
    Ok(teams)
}

// The users whose entries the report counts: the readable ones, narrowed to one member or
// to one team's current members. None means everyone in the organization.
fn report_users(
    db: &Connection,
    scope: &Scope,
    input: &ReportInput,
    teams: &[(String, Vec<String>)],
    readable: Option<Vec<String>>,
) -> Result<Option<Vec<String>>> {
    if let Some(user_id) = &input.user_id {
        if readable.is_some_and(|readable| !readable.contains(user_id)) {
            return refuse(Code::Forbidden, Key::EntriesForbidden);
        }
        return Ok(Some(vec![user_id.clone()]));
    }
    if let Some(team_id) = &input.team_id {
        if let Some((_, user_ids)) = teams.iter().find(|(id, _)| id == team_id) {
            return Ok(Some(user_ids.clone()));
        }
        let exists: Option<String> = crate::sql!(
            "select id from team where (team.id = ",
            team_id,
            " and team.organization_id = ",
            &scope.organization_id,
            ")"
        )
        .query_row(db, |row| row.get(0))
        .optional()?;
        if exists.is_none() {
            return refuse(Code::NotFound, Key::TeamNotFound);
        }
        return refuse(Code::Forbidden, Key::TeamReportForbidden);
    }
    Ok(readable)
}

// The report's entries that touch its range, or None when there are none to read.
fn entries_where(
    scope: &Scope,
    input: &ReportInput,
    range: Range,
    users: &Option<Vec<String>>,
    row: Option<Sql>,
    from: Option<Sql>,
) -> Option<Sql> {
    if users.as_ref().is_some_and(Vec::is_empty) {
        return None;
    }
    let (started_after, stopped_after) = match from {
        Some(from) => (crate::sql!(&from, " - ", MAX_ENTRY_MS), from),
        None => (
            crate::sql!(range.from - MAX_ENTRY_MS),
            crate::sql!(range.from),
        ),
    };
    let row = row.map_or_else(Sql::default, |row| crate::sql!(" and ", row));
    let users = users.as_ref().map_or_else(Sql::default, |users| {
        crate::sql!(" and time_entry.user_id in ", list(users))
    });
    let project = match input.project_id.as_deref() {
        None => Sql::default(),
        Some("none") => crate::sql!(" and time_entry.project_id is null"),
        Some(id) => crate::sql!(" and time_entry.project_id = ", id),
    };
    // sys_deleted = 0 is a literal, so SQLite can use the partial index.
    Some(crate::sql!(
        "((time_entry.organization_id = ",
        &scope.organization_id,
        " and time_entry.sys_deleted = 0)",
        users,
        project,
        " and time_entry.started_at > ",
        started_after,
        " and time_entry.started_at < ",
        range.to,
        " and (time_entry.stopped_at is null or time_entry.stopped_at > ",
        stopped_after,
        ")",
        row,
        ")"
    ))
}

// The people with entries in the organization who aren't members of it any more. The
// recursive CTE walks the organization's users by their index, one probe each.
fn former_members(
    db: &Connection,
    scope: &Scope,
    in_range: &Sql,
    users: &Option<Vec<String>>,
) -> Result<Vec<FormerMember>> {
    let others: Option<Vec<&String>> = users
        .as_ref()
        .map(|users| users.iter().filter(|id| **id != scope.user_id).collect());
    if others.as_ref().is_some_and(Vec::is_empty) {
        return Ok(vec![]);
    }
    let others = others.map_or_else(Sql::default, |others| {
        crate::sql!(" and user.id in ", list(&others))
    });
    let org = &scope.organization_id;
    let former = crate::sql!(
        "select user.id, user.name, user.email from user where (user.id in (with recursive ids(id) as (select min(user_id) from time_entry where organization_id = ",
        org,
        " union all select (select min(user_id) from time_entry where organization_id = ",
        org,
        " and user_id > ids.id) from ids where id is not null) select id from ids) and user.id <> ",
        &scope.user_id,
        others,
        " and not exists (select 1 from member where (member.user_id = user.id and member.organization_id = ",
        org,
        ")) and exists (select 1 from time_entry where (time_entry.user_id = user.id and ",
        in_range,
        ")))"
    )
    .query(db, |row| {
        Ok(FormerMember {
            user_id: row.get(0)?,
            name: row.get(1)?,
            email: row.get(2)?,
        })
    })?;
    Ok(former)
}

struct ReportContext {
    input: ReportInput,
    a: Aggregation,
    users: Option<Vec<String>>,
}

fn report_context(
    db: &Connection,
    scope: &Scope,
    input: ReportInput,
    now: i64,
) -> Result<ReportContext> {
    let (zone, week_start) = settings_of(db, &scope.user_id)?;
    let teams = report_teams(db, scope)?;
    let readable = readable_user_ids(db, scope)?;
    let users = report_users(db, scope, &input, &teams, readable)?;
    let a = Aggregation {
        zone,
        week_start,
        unit: input.unit,
        from: input.from,
        to: input.to,
        now,
        teams,
        tickets: input.tickets.unwrap_or(false),
    };
    Ok(ReportContext { input, a, users })
}

fn report_entries(db: &Connection, scope: &Scope, c: &ReportContext) -> Result<Vec<ReportEntry>> {
    let Some(in_range) = entries_where(scope, &c.input, c.a.range(), &c.users, None, None) else {
        return Ok(vec![]);
    };
    Ok(crate::sql!(
        "select user_id, project_id, ticket, started_at, stopped_at from time_entry where ",
        in_range
    )
    .query(db, |row| {
        Ok(ReportEntry {
            user_id: row.get(0)?,
            project_id: row.get(1)?,
            ticket: row.get(2)?,
            started_at: row.get::<_, Timestamp>(3)?.0,
            stopped_at: row.get::<_, Option<Timestamp>>(4)?.map(|t| t.0),
        })
    })?)
}

pub fn get_report(db: &Connection, scope: &Scope, input: ReportInput) -> Result<Report> {
    get_report_at(db, scope, input, clock::now())
}

fn get_report_at(db: &Connection, scope: &Scope, input: ReportInput, now: i64) -> Result<Report> {
    let c = report_context(db, scope, input, now)?;
    let a = &c.a;
    let range = a.range();
    let (entries, former) = match entries_where(scope, &c.input, range, &c.users, None, None) {
        None => (vec![], vec![]),
        Some(in_range) => (
            report_entries(db, scope, &c)?,
            former_members(db, scope, &in_range, &c.users)?,
        ),
    };
    let totals = aggregate(&entries, a);
    let counted: HashSet<&str> = totals.members.iter().map(|m| m.user_id.as_str()).collect();
    let former_members = former
        .into_iter()
        .filter(|u| counted.contains(u.user_id.as_str()))
        .collect();
    Ok(Report {
        totals: totals.totals,
        buckets: totals.buckets,
        tracked_days: totals.tracked_days,
        entries: totals.entries,
        projects: totals.projects,
        tickets: totals.tickets,
        members: totals.members,
        teams: totals.teams,
        time_zone: a.zone.clone(),
        week_start: a.week_start,
        unit: a.unit,
        from: Timestamp(range.from),
        to: Timestamp(range.to),
        now: Timestamp(now),
        former_members,
    })
}

pub fn get_report_breakdown(
    db: &Connection,
    scope: &Scope,
    input: ReportInput,
) -> Result<ReportBreakdown> {
    let c = report_context(db, scope, input, clock::now())?;
    Ok(aggregation::breakdown_of(
        &report_entries(db, scope, &c)?,
        &c.a,
    ))
}

enum RowCondition {
    All,
    Empty,
    Where(Sql),
}

fn row_where(row: Option<&EntryRow>, teams: &[(String, Vec<String>)]) -> RowCondition {
    let Some(row) = row else {
        return RowCondition::All;
    };
    let id = &row.id;
    RowCondition::Where(match row.group.as_str() {
        "project" if id == "none" => crate::sql!("time_entry.project_id is null"),
        "project" => crate::sql!("time_entry.project_id = ", id),
        "ticket" if id == "none" => crate::sql!("time_entry.ticket is null"),
        "ticket" => crate::sql!("time_entry.ticket = ", id),
        "member" => crate::sql!("time_entry.user_id = ", id),
        _ if id == "none" => {
            let members: HashSet<&String> = teams.iter().flat_map(|(_, ids)| ids).collect();
            if members.is_empty() {
                return RowCondition::All;
            }
            crate::sql!(
                "time_entry.user_id not in ",
                list(&members.into_iter().collect::<Vec<_>>())
            )
        }
        _ => {
            let Some((_, members)) = teams.iter().find(|(team, _)| team == id) else {
                return RowCondition::Empty;
            };
            if members.is_empty() {
                return RowCondition::Empty;
            }
            crate::sql!("time_entry.user_id in ", list(members))
        }
    })
}

fn filtered_where(
    scope: &Scope,
    c: &ReportContext,
    row: Option<&EntryRow>,
    from: Option<Sql>,
) -> Option<Sql> {
    let row = match row_where(row, &c.a.teams) {
        RowCondition::All => None,
        RowCondition::Empty => return None,
        RowCondition::Where(condition) => Some(condition),
    };
    entries_where(scope, &c.input, c.a.range(), &c.users, row, from)
}

struct ListedEntry {
    id: String,
    description: String,
    entry: ReportEntry,
}
fn listed_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<ListedEntry> {
    Ok(ListedEntry {
        id: row.get(0)?,
        description: row.get(3)?,
        entry: ReportEntry {
            user_id: row.get(1)?,
            project_id: row.get(2)?,
            ticket: row.get(4)?,
            started_at: row.get::<_, Timestamp>(5)?.0,
            stopped_at: row.get::<_, Option<Timestamp>>(6)?.map(|t| t.0),
        },
    })
}

fn listed_entries(
    db: &Connection,
    scope: &Scope,
    c: &ReportContext,
    row: Option<&EntryRow>,
) -> Result<Vec<ListedEntry>> {
    let Some(where_) = filtered_where(scope, c, row, None) else {
        return Ok(vec![]);
    };
    Ok(crate::sql!(
        "select id, user_id, project_id, description, ticket, started_at, stopped_at from time_entry where ",
        where_
    ).query(db, listed_entry)?)
}

fn pieces_of(a: &Aggregation, entries: &[ListedEntry]) -> Vec<ReportEntryPiece> {
    let mut pieces = Vec::new();
    let split = DaySplitter::new(a.from, a.to, &a.zone);
    for listed in entries {
        let entry = &listed.entry;
        let Some(span) = counted_span(entry.started_at, entry.stopped_at, a.range(), a.now) else {
            continue;
        };
        let mut from = span.from;
        for (date, ms) in split.split(span.from, span.to) {
            let to = from + ms;
            pieces.push(ReportEntryPiece {
                entry_id: listed.id.clone(),
                user_id: entry.user_id.clone(),
                project_id: entry.project_id.clone(),
                description: listed.description.clone(),
                ticket: entry.ticket.clone(),
                date,
                from: Timestamp(from),
                to: Timestamp(to),
                started_at: Timestamp(entry.started_at),
                stopped_at: entry.stopped_at.map(Timestamp),
                running: entry.stopped_at.is_none() && to == a.now,
                ms,
            });
            from = to;
        }
    }
    pieces.sort_by(|x, y| {
        x.from
            .cmp(&y.from)
            .then_with(|| x.entry_id.cmp(&y.entry_id))
    });
    pieces
}

pub fn get_report_export(
    db: &Connection,
    scope: &Scope,
    input: ReportExportInput,
) -> Result<ReportExport> {
    let at = input.now.map_or(i64::MAX, |t| t.0).min(clock::now());
    let mut piece_input = input.report.clone();
    piece_input.from = input.from;
    piece_input.to = input.to;
    let c = report_context(db, scope, piece_input, at)?;
    let report = if input.now.is_none() {
        Some(get_report_at(db, scope, input.report, at)?)
    } else {
        None
    };
    let entries = pieces_of(&c.a, &listed_entries(db, scope, &c, None)?)
        .into_iter()
        .map(|p| ExportEntry {
            user_id: p.user_id,
            project_id: p.project_id,
            description: p.description,
            ticket: p.ticket,
            date: p.date,
            from: p.from,
            running: p.running,
            ms: p.ms,
        })
        .collect();
    Ok(ReportExport { report, entries })
}

// Probe newest starts, then CROSS JOIN the whole-day window as the outer loop so SQLite
// bounds the index by that window rather than reading every entry in the report.
fn paged_days(
    db: &Connection,
    scope: &Scope,
    c: &ReportContext,
    input: &ReportEntriesInput,
) -> Result<ReportEntries> {
    let Some(where_) = filtered_where(scope, c, input.row.as_ref(), None) else {
        return Ok(aggregation::day_page(vec![], input.after.as_ref()));
    };
    let range = c.a.range();
    let counted = crate::sql!(
        "min(coalesce(time_entry.stopped_at, min(",
        c.a.now,
        ", time_entry.started_at + ",
        MAX_ENTRY_MS,
        ")), ",
        range.to,
        ") > max(time_entry.started_at, ",
        range.from,
        ")"
    );
    let starts: Vec<i64> = (c.a.from.0..c.a.to.0)
        .map(|d| start_of_day(crate::calendar::Day(d), &c.a.zone))
        .collect();
    let starts = serde_json::to_string(&starts).expect("day starts encode");
    let mut limit = ENTRY_PAGE_SIZE as i64 + 1;
    loop {
        let narrowed = filtered_where(
            scope,
            c,
            input.row.as_ref(),
            Some(crate::sql!("day_window.window_from")),
        )
        .expect("same row");
        let query = crate::sql!(
            "with probe as (select time_entry.started_at from time_entry where ",
            &where_,
            " and ",
            &counted,
            " order by time_entry.started_at desc limit ",
            limit,
            "), day_window as (select coalesce(max(cast(value as integer)), ",
            range.from,
            ") as window_from from json_each(",
            &starts,
            ") where cast(value as integer) <= (select case when count(*) < ",
            limit,
            " then ",
            range.from,
            " else min(started_at) end from probe)) ",
            "select time_entry.id, time_entry.user_id, time_entry.project_id, time_entry.description, time_entry.ticket, time_entry.started_at, time_entry.stopped_at, day_window.window_from from day_window cross join time_entry where ",
            narrowed,
            " and ",
            &counted
        );
        let entries = query.query(db, |row| Ok((listed_entry(row)?, row.get::<_, i64>(7)?)))?;
        let Some((_, from)) = entries.first() else {
            return Ok(aggregation::day_page(vec![], input.after.as_ref()));
        };
        let from = *from;
        let narrowed = Aggregation {
            from: local_date(from, &c.a.zone),
            ..c.a.clone()
        };
        let listed: Vec<_> = entries.into_iter().map(|(entry, _)| entry).collect();
        let page = aggregation::day_page(pieces_of(&narrowed, &listed), input.after.as_ref());
        if matches!(&page, ReportEntries::Day { next: Some(_), .. }) || from == range.from {
            return Ok(page);
        }
        limit *= 2;
    }
}

pub fn get_report_entries(
    db: &Connection,
    scope: &Scope,
    input: ReportEntriesInput,
) -> Result<ReportEntries> {
    let mut report = input.report.clone();
    if input.view == "day"
        && let Some(after) = &input.after
    {
        report.to = report.to.min(after.date.add_days(1));
    }
    let c = report_context(db, scope, report, clock::now())?;
    if input.view == "day" {
        return paged_days(db, scope, &c, &input);
    }
    let rows = aggregation::merge_by_description(&pieces_of(
        &c.a,
        &listed_entries(db, scope, &c, input.row.as_ref())?,
    ));
    let row_count = rows.len();
    let offset = input.offset.unwrap_or(0.0) as usize;
    let end = if offset == 0 {
        DESCRIPTION_PAGE_SIZE
    } else {
        row_count
    };
    let next = (end < row_count).then_some(end);
    let rows = rows
        .into_iter()
        .skip(offset)
        .take(end.saturating_sub(offset))
        .collect();
    Ok(ReportEntries::Description {
        rows,
        row_count,
        next,
    })
}

pub fn get_report_entry_totals(
    db: &Connection,
    scope: &Scope,
    input: ReportEntryTotalsInput,
) -> Result<ReportEntryTotals> {
    let c = report_context(db, scope, input.report, clock::now())?;
    let Some(where_) = filtered_where(scope, &c, input.row.as_ref(), None) else {
        return Ok(ReportEntryTotals { count: 0, total: 0 });
    };
    let entries = crate::sql!(
        "select started_at, stopped_at from time_entry where ",
        where_
    )
    .query(db, |row| {
        Ok((
            row.get::<_, Timestamp>(0)?.0,
            row.get::<_, Option<Timestamp>>(1)?.map(|t| t.0),
        ))
    })?;
    let mut count = 0;
    let mut total = 0;
    for (start, stop) in entries {
        if let Some(span) = counted_span(start, stop, c.a.range(), c.a.now) {
            count += 1;
            total += span.to - span.from;
        }
    }
    Ok(ReportEntryTotals { count, total })
}
