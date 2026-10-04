//! The tenancy helper (src/server/scope.server.ts): who is acting, in which organization,
//! with which rights.
use crate::{Code, Key, Result, refuse};
use rusqlite::{Connection, OptionalExtension};

use crate::queries::list;

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
    let membership: Option<String> = crate::sql!(
        "select role from member where organization_id = ",
        organization_id,
        " and user_id = ",
        user_id
    )
    .query_row(db, |row| row.get(0))
    .optional()?;
    let led = crate::sql!("select team_member.team_id from team_member inner join team on team.id = team_member.team_id where team_member.user_id = ",
        user_id, " and team_member.role = 'lead' and team.organization_id = ", organization_id)
        .query(db, |row| row.get(0))?;
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
    let query = crate::sql!(
        "select distinct user_id from team_member where team_id in ",
        list(&scope.led_team_ids)
    );
    let rows = query
        .prepare(db)?
        .query_map(query.params(), |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut users = vec![scope.user_id.clone()];
    users.extend(rows.into_iter().filter(|id| *id != scope.user_id));
    Ok(Some(users))
}
