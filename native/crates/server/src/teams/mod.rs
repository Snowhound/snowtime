pub mod routes;
pub mod schemas;
// Teams and team membership in the scope's organization (src/server/teams/teams.server.ts).
// Only the lists are ported; the writes answer 404.
use self::schemas::{Member, MemberTeam, Team, TeamMember};
use crate::Result;
use crate::schemas::Empty;
use crate::scope::{Scope, strongest_role};
use rusqlite::Connection;

struct Membership {
    team_id: String,
    user_id: String,
    role: String,
}

// Every team membership in the organization, in the order SQLite reads them.
fn team_memberships(db: &Connection, scope: &Scope) -> Result<Vec<Membership>> {
    let rows = crate::sql!(
        "select team_member.team_id, team_member.user_id, team_member.role from team_member inner join team on team.id = team_member.team_id where team.organization_id = ",
        &scope.organization_id
    )
    .query(db, |row| {
        Ok(Membership {
            team_id: row.get(0)?,
            user_id: row.get(1)?,
            role: row.get(2)?,
        })
    })?;
    Ok(rows)
}

// The organization's members by name, each with their organization role and their teams.
pub fn list_members(db: &Connection, scope: &Scope, _: Empty) -> Result<Vec<Member>> {
    let memberships = team_memberships(db, scope)?;
    let members = crate::sql!(
        "select member.id, user.id, user.name, user.email, user.image, member.role, member.created_at from member inner join user on user.id = member.user_id where member.organization_id = ",
        &scope.organization_id,
        " order by user.name asc"
    )
    .query(db, |row| {
        let user_id: String = row.get(1)?;
        Ok(Member {
            member_id: row.get(0)?,
            teams: memberships
                .iter()
                .filter(|m| m.user_id == user_id)
                .map(|m| MemberTeam {
                    team_id: m.team_id.clone(),
                    role: m.role.clone(),
                })
                .collect(),
            user_id,
            name: row.get(2)?,
            email: row.get(3)?,
            image: row.get(4)?,
            org_role: strongest_role(&row.get::<_, String>(5)?),
            joined_at: row.get(6)?,
        })
    })?;
    Ok(members)
}

// The organization's teams by name, each with its members and their team roles.
pub fn list_teams(db: &Connection, scope: &Scope, _: Empty) -> Result<Vec<Team>> {
    let memberships = team_memberships(db, scope)?;
    let teams = crate::sql!(
        "select id, name from team where team.organization_id = ",
        &scope.organization_id,
        " order by team.name asc"
    )
    .query(db, |row| {
        let id: String = row.get(0)?;
        Ok(Team {
            members: memberships
                .iter()
                .filter(|m| m.team_id == id)
                .map(|m| TeamMember {
                    user_id: m.user_id.clone(),
                    role: m.role.clone(),
                })
                .collect(),
            id,
            name: row.get(1)?,
        })
    })?;
    Ok(teams)
}
