//! The project check entries and timers use (src/server/projects/projects.server.ts).
use rusqlite::{Connection, OptionalExtension, params};
use snowtime_core::{Code, Key, Result, refuse};

use crate::scope::{Scope, is_admin};

// Projects the scope's user may see: unassigned ones, those assigned to one of the user's
// teams, and for admins and owners all.
const VISIBLE_PROJECTS: &str = "and (not exists (select 1 from project_team
      where project_team.project_id = project.id)
    or exists (select 1 from project_team
      inner join team_member on team_member.team_id = project_team.team_id
      where project_team.project_id = project.id and team_member.user_id = ?3))";

pub fn assert_usable_project(db: &Connection, scope: &Scope, project_id: &str) -> Result<()> {
    let visible = if is_admin(scope) {
        "and ?3 is not null"
    } else {
        VISIBLE_PROJECTS
    };
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
