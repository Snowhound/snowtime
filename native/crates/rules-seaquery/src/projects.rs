//! The project check entries and timers use (src/server/projects/projects.server.ts).
use rusqlite::Connection;
use sea_query::{Cond, Expr, ExprTrait, Query};
use snowtime_core::{Code, Key, Result, refuse};

use crate::queries::{first, not_deleted};
use crate::schema::{Project, ProjectTeam, TeamMember};
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
