//! Projects in the scope's organization (src/server/projects/projects.server.ts): the list
//! everyone reads, and the check entries and timers use.
use rusqlite::Connection;
use sea_query::{Cond, Expr, ExprTrait, Order, Query};
use snowtime_core::schemas::{ListProjectsInput, ListedProject};
use snowtime_core::{Code, Key, Result, refuse};

use crate::queries::{all, first, live_entry, not_deleted};
use crate::schema::{Project, ProjectTeam, TeamMember, TimeEntry};
use crate::scope::{Scope, is_admin};

// Projects the scope's user may see: unassigned ones, those assigned to one of the user's
// teams, and for admins and owners all.
fn visible_projects(scope: &Scope) -> Option<Cond> {
    if is_admin(scope) {
        return None;
    }
    let assignments = Query::select()
        .column(ProjectTeam::ProjectId)
        .from(ProjectTeam::Table)
        .and_where(
            Expr::col((ProjectTeam::Table, ProjectTeam::ProjectId))
                .equals((Project::Table, Project::Id)),
        )
        .take();
    let own_team_assignments = Query::select()
        .column((ProjectTeam::Table, ProjectTeam::ProjectId))
        .from(ProjectTeam::Table)
        .inner_join(
            TeamMember::Table,
            Expr::col((TeamMember::Table, TeamMember::TeamId))
                .equals((ProjectTeam::Table, ProjectTeam::TeamId)),
        )
        .and_where(
            Expr::col((ProjectTeam::Table, ProjectTeam::ProjectId))
                .equals((Project::Table, Project::Id)),
        )
        .and_where(Expr::col((TeamMember::Table, TeamMember::UserId)).eq(&scope.user_id))
        .take();
    Some(
        Cond::any()
            .add(Expr::not_exists(assignments))
            .add(Expr::exists(own_team_assignments)),
    )
}

// What the API sends of a project.
const PROJECT_COLUMNS: [(Project, Project); 4] = [
    (Project::Table, Project::Id),
    (Project::Table, Project::Name),
    (Project::Table, Project::Color),
    (Project::Table, Project::ArchivedAt),
];

pub fn assert_usable_project(db: &Connection, scope: &Scope, project_id: &str) -> Result<()> {
    let row: Option<Option<i64>> = first(
        db,
        Query::select()
            .column(Project::ArchivedAt)
            .from(Project::Table)
            .and_where(Expr::col((Project::Table, Project::Id)).eq(project_id))
            .and_where(
                Expr::col((Project::Table, Project::OrganizationId)).eq(&scope.organization_id),
            )
            .and_where(not_deleted((Project::Table, Project::SysDeleted)))
            .cond_where(visible_projects(scope).unwrap_or_else(Cond::all)),
        |row| row.get(0),
    )?;
    match row {
        None => refuse(Code::NotFound, Key::ProjectNotFound),
        Some(Some(_)) => refuse(Code::Conflict, Key::ProjectArchived),
        Some(None) => Ok(()),
    }
}

// The projects the user may see, by name, each with whether it has live time entries,
// which deleteProject refuses, and the ids of the teams it is assigned to. Archived ones
// only on request.
pub fn list_projects(
    db: &Connection,
    scope: &Scope,
    input: ListProjectsInput,
) -> Result<Vec<ListedProject>> {
    // Reads time_entry_project_id_idx, one indexed lookup per project.
    let entries = Query::select()
        .column((TimeEntry::Table, TimeEntry::Id))
        .from(TimeEntry::Table)
        .and_where(
            Expr::col((TimeEntry::Table, TimeEntry::ProjectId))
                .equals((Project::Table, Project::Id)),
        )
        .cond_where(live_entry(&scope.organization_id))
        .take();
    let rows = all(
        db,
        Query::select()
            .columns(PROJECT_COLUMNS)
            .expr(Expr::exists(entries))
            .from(Project::Table)
            .and_where(
                Expr::col((Project::Table, Project::OrganizationId)).eq(&scope.organization_id),
            )
            .and_where(not_deleted((Project::Table, Project::SysDeleted)))
            .cond_where(visible_projects(scope).unwrap_or_else(Cond::all))
            .and_where_option(
                (!input.include_archived)
                    .then(|| Expr::col((Project::Table, Project::ArchivedAt)).is_null()),
            )
            .order_by((Project::Table, Project::Name), Order::Asc),
        |row| {
            Ok(ListedProject {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                archived_at: row.get(3)?,
                has_entries: row.get(4)?,
                team_ids: Vec::new(),
            })
        },
    )?;
    // All the organization's assignments, read as the TypeScript reads them, so each
    // project's team ids come in the same order; those of unlisted projects are dropped.
    let assignments: Vec<(String, String)> = all(
        db,
        Query::select()
            .columns([ProjectTeam::ProjectId, ProjectTeam::TeamId])
            .from(ProjectTeam::Table)
            .and_where(Expr::col(ProjectTeam::OrganizationId).eq(&scope.organization_id)),
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(rows
        .into_iter()
        .map(|mut project| {
            project.team_ids = assignments
                .iter()
                .filter(|(project_id, _)| *project_id == project.id)
                .map(|(_, team_id)| team_id.clone())
                .collect();
            project
        })
        .collect())
}
