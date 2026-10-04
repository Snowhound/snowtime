pub mod aggregation;
pub mod routes;
pub mod schemas;
// Reports: time totals per day or week, project, team and member, in the user's time zone
// (src/server/reports/reports.server.ts). Only getReport is ported; the breakdown, entry
// lists, and export answer 404. Everyone reports on the entries they may read; team totals
// count each team's current members.
use self::aggregation::{Aggregation, ReportEntry, aggregate};
use self::schemas::{FormerMember, Report, ReportInput};
use crate::calendar::{Range, WeekStart, Zone};
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
) -> Option<Sql> {
    if users.as_ref().is_some_and(Vec::is_empty) {
        return None;
    }
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
        range.from - MAX_ENTRY_MS,
        " and time_entry.started_at < ",
        range.to,
        " and (time_entry.stopped_at is null or time_entry.stopped_at > ",
        range.from,
        "))"
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

pub fn get_report(db: &Connection, scope: &Scope, input: ReportInput) -> Result<Report> {
    let now = clock::now();
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
    let range = a.range();
    let (entries, former) = match entries_where(scope, &input, range, &users) {
        None => (vec![], vec![]),
        Some(in_range) => {
            let entries = crate::sql!(
                "select user_id, project_id, ticket, started_at, stopped_at from time_entry where ",
                &in_range
            )
            .query(db, |row| {
                Ok(ReportEntry {
                    user_id: row.get(0)?,
                    project_id: row.get(1)?,
                    ticket: row.get(2)?,
                    started_at: row.get::<_, Timestamp>(3)?.0,
                    stopped_at: row.get::<_, Option<Timestamp>>(4)?.map(|t| t.0),
                })
            })?;
            (entries, former_members(db, scope, &in_range, &users)?)
        }
    };
    let totals = aggregate(&entries, &a);
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
        time_zone: a.zone,
        week_start: a.week_start,
        unit: a.unit,
        from: Timestamp(range.from),
        to: Timestamp(range.to),
        now: Timestamp(now),
        former_members,
    })
}
