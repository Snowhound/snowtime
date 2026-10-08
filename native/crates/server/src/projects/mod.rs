pub mod routes;
pub mod schemas;
// Projects in the scope's organization (src/server/projects/projects.server.ts): the list
// everyone reads, and the check entries and timers use.
use std::collections::HashMap;

use self::schemas::*;
use crate::queries::{Assignments, failed_constraint};
use crate::{Code, Error, Key, Result, refuse};
use crate::{clock, schemas::Patch};
use rusqlite::{Connection, OptionalExtension, Row};

use crate::scope::{Scope, is_admin};

fn assert_admin(scope: &Scope) -> Result<()> {
    if !is_admin(scope) {
        return refuse(Code::Forbidden, Key::ProjectsForbidden);
    }
    Ok(())
}
fn project_of(row: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        archived_at: row.get(3)?,
    })
}
fn find_project(db: &Connection, scope: &Scope, id: &str) -> Result<Project> {
    crate::sql!(
        "select id, name, color, archived_at from project where id = ",
        id,
        " and organization_id = ",
        &scope.organization_id,
        " and sys_deleted = 0"
    )
    .query_row(db, project_of)
    .optional()?
    .map_or_else(|| refuse(Code::NotFound, Key::ProjectNotFound), Ok)
}
pub fn create_project(
    db: &Connection,
    scope: &Scope,
    input: CreateProjectInput,
) -> Result<Project> {
    assert_admin(scope)?;
    let total: i64 = crate::sql!(
        "select count(*) from project where organization_id = ",
        &scope.organization_id,
        " and sys_deleted = 0"
    )
    .query_row(db, |r| r.get(0))?;
    if total >= 1000 {
        return refuse(Code::LimitReached, Key::ProjectLimit);
    }
    let result = crate::sql!(
        "insert into project (id, organization_id, name, color, created_by, updated_by) values (",
        input.id,
        ", ",
        &scope.organization_id,
        ", ",
        input.name,
        ", ",
        input.color,
        ", ",
        &scope.user_id,
        ", ",
        &scope.user_id,
        ") returning id, name, color, archived_at"
    )
    .query_row(db, project_of);
    match result {
        Ok(row) => Ok(row),
        Err(error) => match failed_constraint(&error) {
            Some("project.id" | "project.id, project.organization_id") => {
                refuse(Code::Conflict, Key::ProjectIdTaken)
            }
            Some("project.organization_id, project.name") => {
                refuse(Code::Conflict, Key::ProjectNameTaken)
            }
            _ => Err(error.into()),
        },
    }
}
pub fn update_project(
    db: &Connection,
    scope: &Scope,
    input: UpdateProjectInput,
) -> Result<Project> {
    assert_admin(scope)?;
    let existing = find_project(db, scope, &input.id)?;
    if input.name.is_none() && matches!(input.color, Patch::Absent) {
        return Ok(existing);
    }
    let mut assignments = Assignments::default();
    assignments.set_optional("name", input.name);
    assignments.set("color", input.color);
    assignments.set("updated_at", Patch::Value(clock::now()));
    assignments.set("updated_by", Patch::Value(&scope.user_id));
    let result = crate::sql!(
        "update project set ",
        assignments.finish(),
        " where id = ",
        existing.id,
        " and organization_id = ",
        &scope.organization_id,
        " and sys_deleted = 0 returning id, name, color, archived_at"
    )
    .query_row(db, project_of)
    .optional();
    match result {
        Ok(Some(row)) => Ok(row),
        Ok(None) => refuse(Code::NotFound, Key::ProjectNotFound),
        Err(error) => match failed_constraint(&error) {
            Some("project.organization_id, project.name") => {
                refuse(Code::Conflict, Key::ProjectNameTaken)
            }
            _ => Err(error.into()),
        },
    }
}
fn set_archived(db: &Connection, scope: &Scope, id: &str, archived: bool) -> Result<Project> {
    assert_admin(scope)?;
    let existing = find_project(db, scope, id)?;
    if existing.archived_at.is_some() == archived {
        return Ok(existing);
    }
    crate::sql!(
        "update project set archived_at = ",
        archived.then(clock::now),
        ", updated_at = ",
        clock::now(),
        ", updated_by = ",
        &scope.user_id,
        " where id = ",
        id,
        " and organization_id = ",
        &scope.organization_id,
        " and sys_deleted = 0 returning id, name, color, archived_at"
    )
    .query_row(db, project_of)
    .optional()?
    .map_or_else(|| refuse(Code::NotFound, Key::ProjectNotFound), Ok)
}
pub fn archive_project(db: &Connection, scope: &Scope, input: ProjectIdInput) -> Result<Project> {
    set_archived(db, scope, &input.id, true)
}
pub fn unarchive_project(db: &Connection, scope: &Scope, input: ProjectIdInput) -> Result<Project> {
    set_archived(db, scope, &input.id, false)
}
pub fn delete_project(
    db: &Connection,
    scope: &Scope,
    input: ProjectIdInput,
) -> Result<ProjectIdInput> {
    assert_admin(scope)?;
    let existing = find_project(db, scope, &input.id)?;
    let tx = rusqlite::Transaction::new_unchecked(db, rusqlite::TransactionBehavior::Immediate)?;
    let used = crate::sql!(
        "select id from time_entry where project_id = ",
        &existing.id,
        " and organization_id = ",
        &scope.organization_id,
        " and sys_deleted = 0 limit 1"
    )
    .query_row(&tx, |r| r.get::<_, String>(0))
    .optional()?;
    if used.is_some() {
        return refuse(Code::Conflict, Key::ProjectHasEntries);
    }
    crate::sql!(
        "delete from project_team where project_id = ",
        &existing.id,
        " and organization_id = ",
        &scope.organization_id
    )
    .execute(&tx)?;
    let deleted = crate::sql!(
        "update project set sys_deleted = 1, updated_at = ",
        clock::now(),
        ", updated_by = ",
        &scope.user_id,
        " where id = ",
        &existing.id,
        " and organization_id = ",
        &scope.organization_id,
        " and sys_deleted = 0 returning id"
    )
    .query_row(&tx, |r| Ok(ProjectIdInput { id: r.get(0)? }))
    .optional();
    let deleted = match deleted {
        Ok(Some(row)) => row,
        Ok(None) => return refuse(Code::NotFound, Key::ProjectNotFound),
        Err(error) if failed_constraint(&error) == Some("project_deleted_with_entries") => {
            return refuse(Code::Conflict, Key::ProjectHasEntries);
        }
        Err(error) => return Err(error.into()),
    };
    tx.commit()?;
    Ok(deleted)
}
fn assert_team_in_scope(db: &Connection, scope: &Scope, team_id: &str) -> Result<()> {
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
pub fn assign_project_to_team(
    db: &Connection,
    scope: &Scope,
    input: ProjectTeamInput,
) -> Result<ProjectTeamInput> {
    assert_admin(scope)?;
    find_project(db, scope, &input.project_id)?;
    assert_team_in_scope(db, scope, &input.team_id)?;
    crate::sql!(
        "insert into project_team (project_id, team_id, organization_id, created_by) values (",
        &input.project_id,
        ", ",
        &input.team_id,
        ", ",
        &scope.organization_id,
        ", ",
        &scope.user_id,
        ") on conflict do nothing"
    )
    .execute(db)?;
    Ok(input)
}
pub fn unassign_project_from_team(
    db: &Connection,
    scope: &Scope,
    input: ProjectTeamInput,
) -> Result<ProjectTeamInput> {
    assert_admin(scope)?;
    find_project(db, scope, &input.project_id)?;
    assert_team_in_scope(db, scope, &input.team_id)?;
    crate::sql!(
        "delete from project_team where project_id = ",
        &input.project_id,
        " and team_id = ",
        &input.team_id,
        " and organization_id = ",
        &scope.organization_id
    )
    .execute(db)?;
    Ok(input)
}

fn visible_projects(scope: &Scope) -> crate::queries::Sql {
    if is_admin(scope) {
        return crate::queries::Sql::default();
    }
    crate::sql!(
        " and (not exists (select 1 from project_team where project_team.project_id = project.id) or exists (select 1 from project_team inner join team_member on team_member.team_id = project_team.team_id where project_team.project_id = project.id and team_member.user_id = ",
        &scope.user_id,
        "))"
    )
}

pub fn assert_usable_project(db: &Connection, scope: &Scope, project_id: &str) -> Result<()> {
    let archived_at: Option<Option<i64>> = crate::sql!(
        "select archived_at from project where id = ",
        project_id,
        " and organization_id = ",
        &scope.organization_id,
        " and sys_deleted = 0",
        visible_projects(scope)
    )
    .query_row(db, |row| row.get(0))
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
    let rows = crate::sql!(
        "select project_id, team_id from project_team where organization_id = ",
        &scope.organization_id
    )
    .query(db, |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (project_id, team_id) = row;
        team_ids.entry(project_id).or_default().push(team_id);
    }

    // hasEntries reads time_entry_project_id_idx, one indexed lookup per project.
    let projects = crate::sql!("select id, name, color, archived_at, exists (select 1 from time_entry where time_entry.project_id = project.id and time_entry.organization_id = ",
        &scope.organization_id, " and time_entry.sys_deleted = 0) from project where organization_id = ",
        &scope.organization_id, " and sys_deleted = 0", visible_projects(scope),
        " and (", input.include_archived, " or archived_at is null) order by name")
        .query(db, |row| {
                let id: String = row.get(0)?;
                Ok(ListedProject {
                    team_ids: team_ids.remove(&id).unwrap_or_default(),
                    id,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    archived_at: row.get(3)?,
                    has_entries: row.get(4)?,
                })
            }).map_err(Error::from)?;
    Ok(projects)
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
        db.execute_batch("insert into user (id,name,email,email_verified,created_at,updated_at) values ('alice','Alice','alice@example.com',1,0,0); insert into organization (id,name,slug,created_at) values ('org','Org','org',0); insert into team (id,name,organization_id,created_at) values ('team','Team','org',0)").unwrap();
        db
    }
    fn scope(role: OrgRole) -> Scope {
        Scope {
            user_id: "alice".into(),
            organization_id: "org".into(),
            org_role: role,
            led_team_ids: vec![],
        }
    }
    const ID: &str = "01900000-0000-7000-8010-000000000001";
    #[test]
    fn project_lifecycle_keeps_audit_and_removes_assignments() {
        let db = database();
        let owner = scope(OrgRole::Owner);
        let created =
            create_project(&db, &owner, decode(json!({"id":ID,"name":" P "})).unwrap()).unwrap();
        assert_eq!(created.name, "P");
        let assignment = || ProjectTeamInput {
            project_id: ID.into(),
            team_id: "team".into(),
        };
        assign_project_to_team(&db, &owner, assignment()).unwrap();
        assign_project_to_team(&db, &owner, assignment()).unwrap();
        let archived = archive_project(&db, &owner, ProjectIdInput { id: ID.into() }).unwrap();
        assert_eq!(
            archive_project(&db, &owner, ProjectIdInput { id: ID.into() })
                .unwrap()
                .archived_at,
            archived.archived_at
        );
        assert!(
            list_projects(
                &db,
                &owner,
                ListProjectsInput {
                    include_archived: false
                }
            )
            .unwrap()
            .is_empty()
        );
        let changed = update_project(
            &db,
            &owner,
            decode(json!({"id":ID,"color":"#abcdef"})).unwrap(),
        )
        .unwrap();
        assert_eq!(changed.name, "P");
        assert_eq!(changed.archived_at, archived.archived_at);
        assert_eq!(
            update_project(&db, &owner, decode(json!({"id":ID,"color":null})).unwrap())
                .unwrap()
                .color,
            None
        );
        unarchive_project(&db, &owner, ProjectIdInput { id: ID.into() }).unwrap();
        delete_project(&db, &owner, ProjectIdInput { id: ID.into() }).unwrap();
        assert_eq!(
            db.query_row("select count(*) from project_team", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.query_row("select sys_deleted,updated_by from project", [], |r| Ok((
                r.get::<_, bool>(0)?,
                r.get::<_, String>(1)?
            )))
            .unwrap(),
            (true, "alice".into())
        );
    }
    #[test]
    fn member_refusal_precedes_lookup_and_limit_precedes_conflict() {
        let db = database();
        assert!(matches!(
            archive_project(
                &db,
                &scope(OrgRole::Member),
                ProjectIdInput { id: ID.into() }
            ),
            Err(Error::App(crate::AppError {
                key: Key::ProjectsForbidden,
                ..
            }))
        ));
        db.execute_batch("with recursive n(x) as (select 1 union all select x+1 from n where x<1000) insert into project (id,organization_id,name,created_by,updated_by) select 'p'||x,'org','P'||x,'alice','alice' from n").unwrap();
        assert!(matches!(
            create_project(
                &db,
                &scope(OrgRole::Admin),
                decode(json!({"id":ID,"name":"P1"})).unwrap()
            ),
            Err(Error::App(crate::AppError {
                key: Key::ProjectLimit,
                ..
            }))
        ));
    }
    #[test]
    fn project_validation_orders_fields_and_counts_utf16() {
        assert!(
            matches!(decode::<CreateProjectInput>(json!({"id":ID,"name":" ","color":"bad"})), Err(Error::Invalid(message)) if message == "Enter a name.")
        );
        assert!(
            matches!(decode::<UpdateProjectInput>(json!({"id":ID,"name":"😀".repeat(51)})), Err(Error::Invalid(message)) if message == "Use at most 100 characters.")
        );
        assert!(decode::<UpdateProjectInput>(json!({"id":ID,"name":null})).is_err());
    }
}
