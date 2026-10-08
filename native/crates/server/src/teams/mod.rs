pub mod routes;
pub mod schemas;
// Teams and team membership in the scope's organization (src/server/teams/teams.server.ts).
use self::schemas::*;
use crate::queries::failed_constraint;
use crate::schemas::Empty;
use crate::scope::{Scope, is_admin, strongest_role};
use crate::{Code, Error, Key, Result, clock, refuse};
use rusqlite::{Connection, OptionalExtension};

fn assert_admin(scope: &Scope) -> Result<()> {
    if !is_admin(scope) {
        return refuse(Code::Forbidden, Key::TeamsForbidden);
    }
    Ok(())
}
pub(crate) fn assert_team_in_scope(db: &Connection, scope: &Scope, team_id: &str) -> Result<()> {
    let found = crate::sql!(
        "select id from team where id = ",
        team_id,
        " and organization_id = ",
        &scope.organization_id
    )
    .query_row(db, |r| r.get::<_, String>(0))
    .optional()?;
    if found.is_none() {
        return refuse(Code::NotFound, Key::TeamNotFound);
    }
    Ok(())
}
fn name_failure(error: rusqlite::Error) -> Error {
    if failed_constraint(&error) == Some("team.organization_id, team.name") {
        return crate::AppError {
            code: Code::Conflict,
            key: Key::TeamNameTaken,
        }
        .into();
    }
    error.into()
}
pub fn create_team(db: &Connection, scope: &Scope, input: CreateTeamInput) -> Result<TeamName> {
    assert_admin(scope)?;
    let tx = db.unchecked_transaction()?;
    let count: i64 = crate::sql!(
        "select count(*) from team where organization_id = ",
        &scope.organization_id
    )
    .query_row(&tx, |r| r.get(0))?;
    if count >= 100 {
        return refuse(Code::LimitReached, Key::TeamLimit);
    }
    let row = crate::sql!(
        "insert into team (id, organization_id, name, created_at) values (",
        uuid::Uuid::now_v7().to_string(),
        ", ",
        &scope.organization_id,
        ", ",
        input.name,
        ", ",
        clock::now(),
        ") returning id, name"
    )
    .query_row(&tx, |r| {
        Ok(TeamName {
            id: r.get(0)?,
            name: r.get(1)?,
        })
    })
    .map_err(name_failure)?;
    tx.commit()?;
    Ok(row)
}
pub fn rename_team(db: &Connection, scope: &Scope, input: RenameTeamInput) -> Result<TeamName> {
    assert_admin(scope)?;
    crate::sql!(
        "update team set name = ",
        input.name,
        ", updated_at = ",
        clock::now(),
        " where id = ",
        input.team_id,
        " and organization_id = ",
        &scope.organization_id,
        " returning id, name"
    )
    .query_row(db, |r| {
        Ok(TeamName {
            id: r.get(0)?,
            name: r.get(1)?,
        })
    })
    .optional()
    .map_err(name_failure)?
    .map_or_else(|| refuse(Code::NotFound, Key::TeamNotFound), Ok)
}
pub fn delete_team(db: &Connection, scope: &Scope, input: TeamIdInput) -> Result<DeletedTeam> {
    assert_admin(scope)?;
    crate::sql!(
        "delete from team where id = ",
        input.team_id,
        " and organization_id = ",
        &scope.organization_id,
        " returning id"
    )
    .query_row(db, |r| Ok(DeletedTeam { id: r.get(0)? }))
    .optional()?
    .map_or_else(|| refuse(Code::NotFound, Key::TeamNotFound), Ok)
}
pub(crate) fn insert_team_member(db: &Connection, team_id: &str, user_id: &str) -> Result<()> {
    let added = crate::sql!(
        "insert into team_member (id,team_id,user_id,created_at) values (",
        uuid::Uuid::now_v7().to_string(),
        ", ",
        team_id,
        ", ",
        user_id,
        ", ",
        clock::now(),
        ") on conflict do nothing returning id"
    )
    .query_row(db, |r| r.get::<_, String>(0))
    .optional()?;
    if added.is_some() {
        crate::sql!(
            "update team set member_count = member_count + 1 where id = ",
            team_id
        )
        .execute(db)?;
    }
    Ok(())
}
pub fn add_team_member(
    db: &Connection,
    scope: &Scope,
    input: TeamMemberInput,
) -> Result<TeamMemberInput> {
    assert_admin(scope)?;
    let tx = db.unchecked_transaction()?;
    assert_team_in_scope(&tx, scope, &input.team_id)?;
    let found = crate::sql!(
        "select id from member where organization_id = ",
        &scope.organization_id,
        " and user_id = ",
        &input.user_id
    )
    .query_row(&tx, |r| r.get::<_, String>(0))
    .optional()?;
    if found.is_none() {
        return refuse(Code::NotFound, Key::MemberNotFound);
    }
    insert_team_member(&tx, &input.team_id, &input.user_id)?;
    tx.commit()?;
    Ok(input)
}
pub fn remove_team_member(
    db: &Connection,
    scope: &Scope,
    input: TeamMemberInput,
) -> Result<TeamMemberInput> {
    assert_admin(scope)?;
    let tx = db.unchecked_transaction()?;
    assert_team_in_scope(&tx, scope, &input.team_id)?;
    let removed = crate::sql!(
        "delete from team_member where team_id = ",
        &input.team_id,
        " and user_id = ",
        &input.user_id,
        " returning id"
    )
    .query_row(&tx, |r| r.get::<_, String>(0))
    .optional()?;
    if removed.is_none() {
        return refuse(Code::NotFound, Key::TeamMemberNotFound);
    }
    crate::sql!(
        "update team set member_count = member_count - 1 where id = ",
        &input.team_id
    )
    .execute(&tx)?;
    tx.commit()?;
    Ok(input)
}
pub fn set_team_role(
    db: &Connection,
    scope: &Scope,
    input: SetTeamRoleInput,
) -> Result<SetTeamRoleInput> {
    assert_admin(scope)?;
    assert_team_in_scope(db, scope, &input.team_id)?;
    crate::sql!(
        "update team_member set role = ",
        input.role,
        " where team_id = ",
        input.team_id,
        " and user_id = ",
        input.user_id,
        " returning team_id,user_id,role"
    )
    .query_row(db, |r| {
        Ok(SetTeamRoleInput {
            team_id: r.get(0)?,
            user_id: r.get(1)?,
            role: r.get(2)?,
        })
    })
    .optional()?
    .map_or_else(|| refuse(Code::NotFound, Key::TeamMemberNotFound), Ok)
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{schemas::decode, scope::OrgRole};
    use serde_json::json;
    fn database() -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        crate::migrations::migrate(
            &mut db,
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../drizzle"),
        )
        .unwrap();
        db.execute_batch("insert into user (id,name,email,email_verified,created_at,updated_at) values ('alice','Alice','alice@example.com',1,0,0); insert into organization (id,name,slug,created_at) values ('org','Org','org',0); insert into member (id,user_id,organization_id,role,created_at) values ('member','alice','org','owner',0)").unwrap();
        db
    }
    fn scope() -> Scope {
        Scope {
            user_id: "alice".into(),
            organization_id: "org".into(),
            org_role: OrgRole::Owner,
            led_team_ids: vec![],
        }
    }
    #[test]
    fn repeat_add_preserves_role_and_count_and_remove_updates_count_once() {
        let db = database();
        let scope = scope();
        let team = create_team(&db, &scope, CreateTeamInput { name: "T".into() }).unwrap();
        let input = || TeamMemberInput {
            team_id: team.id.clone(),
            user_id: "alice".into(),
        };
        add_team_member(&db, &scope, input()).unwrap();
        set_team_role(
            &db,
            &scope,
            SetTeamRoleInput {
                team_id: team.id.clone(),
                user_id: "alice".into(),
                role: "lead".into(),
            },
        )
        .unwrap();
        add_team_member(&db, &scope, input()).unwrap();
        assert_eq!(
            db.query_row("select member_count from team", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            list_teams(&db, &scope, Empty {}).unwrap()[0].members[0].role,
            "lead"
        );
        remove_team_member(&db, &scope, input()).unwrap();
        assert!(matches!(
            remove_team_member(&db, &scope, input()),
            Err(Error::App(crate::AppError {
                key: Key::TeamMemberNotFound,
                ..
            }))
        ));
        assert_eq!(
            db.query_row("select member_count from team", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn limit_and_refusal_precedence_and_last_team_deletion() {
        let db = database();
        let mut member = scope();
        member.org_role = OrgRole::Member;
        let scope = scope();
        assert!(matches!(
            add_team_member(
                &db,
                &member,
                TeamMemberInput {
                    team_id: "missing".into(),
                    user_id: "missing".into()
                }
            ),
            Err(Error::App(crate::AppError {
                key: Key::TeamsForbidden,
                ..
            }))
        ));
        let t = create_team(
            &db,
            &scope,
            CreateTeamInput {
                name: "Only".into(),
            },
        )
        .unwrap();
        add_team_member(
            &db,
            &scope,
            TeamMemberInput {
                team_id: t.id.clone(),
                user_id: "alice".into(),
            },
        )
        .unwrap();
        delete_team(&db, &scope, TeamIdInput { team_id: t.id }).unwrap();
        assert_eq!(
            db.query_row("select count(*) from team_member", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        db.execute_batch("with recursive n(x) as (select 1 union all select x+1 from n where x<100) insert into team (id,organization_id,name,created_at) select 't'||x,'org','T'||x,0 from n").unwrap();
        assert!(matches!(
            create_team(&db, &scope, CreateTeamInput { name: "T1".into() }),
            Err(Error::App(crate::AppError {
                key: Key::TeamLimit,
                ..
            }))
        ));
    }
    #[test]
    fn role_schema_checks_ids_before_role() {
        assert!(
            matches!(decode::<SetTeamRoleInput>(json!({"teamId":"bad","userId":null,"role":"owner"})),Err(Error::Invalid(message)) if message=="Invalid id.")
        );
        assert!(
            matches!(decode::<CreateTeamInput>(json!({"name":"😀".repeat(51)})),Err(Error::Invalid(message)) if message=="Use at most 100 characters.")
        );
    }
}
