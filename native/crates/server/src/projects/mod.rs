pub mod routes;
pub mod schemas;
// Projects in the scope's organization (src/server/projects/projects.server.ts): the list
// everyone reads, and the check entries and timers use.
use std::collections::HashMap;

use self::schemas::{ListProjectsInput, ListedProject};
use crate::{Code, Error, Key, Result, refuse};
use rusqlite::{Connection, OptionalExtension, params};

use crate::scope::{Scope, is_admin};

// Projects the scope's user may see: unassigned ones, those assigned to one of the user's
// teams, and for admins and owners all. The user's id is ?3; an admin's condition still
// names it, so a statement takes the same parameters for every role.
fn visible_projects(scope: &Scope) -> &'static str {
    if is_admin(scope) {
        return "and ?3 is not null";
    }
    "and (not exists (select 1 from project_team
      where project_team.project_id = project.id)
    or exists (select 1 from project_team
      inner join team_member on team_member.team_id = project_team.team_id
      where project_team.project_id = project.id and team_member.user_id = ?3))"
}

pub fn assert_usable_project(db: &Connection, scope: &Scope, project_id: &str) -> Result<()> {
    let visible = visible_projects(scope);
    let archived_at: Option<Option<i64>> = db
        .prepare_cached(&format!(
            "select archived_at from project
             where id = ?1 and organization_id = ?2 and sys_deleted = 0 {visible}"
        ))?
        .query_row(
            params![project_id, scope.organization_id, scope.user_id],
            |row| row.get(0),
        )
        .optional()?;
    match archived_at {
        None => refuse(Code::NotFound, Key::ProjectNotFound),
        Some(Some(_)) => refuse(Code::Conflict, Key::ProjectArchived),
        Some(None) => Ok(()),
    }
}

// The projects the user may see, by name, each with the ids of the teams it is assigned
// to and whether it has live time entries, which deleteProject refuses. Archived ones only
// on request.
pub fn list_projects(
    db: &Connection,
    scope: &Scope,
    input: ListProjectsInput,
) -> Result<Vec<ListedProject>> {
    // The organization's assignments in one read; those of unlisted projects go unused.
    let mut team_ids: HashMap<String, Vec<String>> = HashMap::new();
    let mut assignments = db.prepare_cached(
        "select project_id, team_id from project_team where organization_id = ?1",
    )?;
    let rows = assignments.query_map(params![scope.organization_id], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })?;
    for row in rows {
        let (project_id, team_id): (String, String) = row?;
        team_ids.entry(project_id).or_default().push(team_id);
    }

    // hasEntries reads time_entry_project_id_idx, one indexed lookup per project.
    let visible = visible_projects(scope);
    let projects = db
        .prepare_cached(&format!(
            "select id, name, color, archived_at,
               exists (select 1 from time_entry
                 where time_entry.project_id = project.id
                   and time_entry.organization_id = ?1 and time_entry.sys_deleted = 0)
             from project
             where organization_id = ?1 and sys_deleted = 0 {visible}
               and (?2 or archived_at is null)
             order by name"
        ))?
        .query_map(
            params![scope.organization_id, input.include_archived, scope.user_id],
            |row| {
                let id: String = row.get(0)?;
                Ok(ListedProject {
                    team_ids: team_ids.remove(&id).unwrap_or_default(),
                    id,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    archived_at: row.get(3)?,
                    has_entries: row.get(4)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Error::from)?;
    Ok(projects)
}
