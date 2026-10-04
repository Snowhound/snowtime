//! The tenancy helper (src/server/scope.server.ts): who is acting, in which organization,
//! with which rights.
use rusqlite::Connection;
use sea_query::{Expr, ExprTrait, Query};
use snowtime_core::{Code, Key, Result, refuse};

use crate::queries::{all, first};
use crate::schema::{Member, Team, TeamMember};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrgRole {
    Owner,
    Admin,
    Member,
}

pub struct Scope {
    pub user_id: String,
    pub organization_id: String,
    pub org_role: OrgRole,
    // Teams in this organization the user leads; team leads read their members' entries.
    pub led_team_ids: Vec<String>,
}

// Better Auth stores several roles as a comma-separated list; the strongest one wins. The
// list is split without trimming, as Better Auth's permission check splits it.
pub fn strongest_role(role: &str) -> OrgRole {
    let roles: Vec<&str> = role.split(',').collect();
    if roles.contains(&"owner") {
        OrgRole::Owner
    } else if roles.contains(&"admin") {
        OrgRole::Admin
    } else {
        OrgRole::Member
    }
}

pub fn resolve_scope(db: &Connection, user_id: &str, organization_id: &str) -> Result<Scope> {
    let membership: Option<String> = first(
        db,
        Query::select()
            .column(Member::Role)
            .from(Member::Table)
            .and_where(Expr::col(Member::OrganizationId).eq(organization_id))
            .and_where(Expr::col(Member::UserId).eq(user_id)),
        |row| row.get(0),
    )?;
    let led: Vec<String> = all(
        db,
        Query::select()
            .column((TeamMember::Table, TeamMember::TeamId))
            .from(TeamMember::Table)
            .inner_join(
                Team::Table,
                Expr::col((Team::Table, Team::Id)).equals((TeamMember::Table, TeamMember::TeamId)),
            )
            .and_where(Expr::col((TeamMember::Table, TeamMember::UserId)).eq(user_id))
            .and_where(Expr::col((TeamMember::Table, TeamMember::Role)).eq("lead"))
            .and_where(Expr::col((Team::Table, Team::OrganizationId)).eq(organization_id)),
        |row| row.get(0),
    )?;
    let Some(role) = membership else {
        return refuse(Code::Forbidden, Key::NotOrganizationMember);
    };
    Ok(Scope {
        user_id: user_id.to_owned(),
        organization_id: organization_id.to_owned(),
        org_role: strongest_role(&role),
        led_team_ids: led,
    })
}

pub fn is_admin(scope: &Scope) -> bool {
    matches!(scope.org_role, OrgRole::Owner | OrgRole::Admin)
}

// Users whose entries the scope may read: everyone for admins and owners (None), else the
// user plus the members of the teams they lead.
pub fn readable_user_ids(db: &Connection, scope: &Scope) -> Result<Option<Vec<String>>> {
    if is_admin(scope) {
        return Ok(None);
    }
    if scope.led_team_ids.is_empty() {
        return Ok(Some(vec![scope.user_id.clone()]));
    }
    let rows: Vec<String> = all(
        db,
        Query::select()
            .distinct()
            .column(TeamMember::UserId)
            .from(TeamMember::Table)
            .and_where(Expr::col(TeamMember::TeamId).is_in(scope.led_team_ids.iter().cloned())),
        |row| row.get(0),
    )?;
    let mut users = vec![scope.user_id.clone()];
    users.extend(rows.into_iter().filter(|id| *id != scope.user_id));
    Ok(Some(users))
}
