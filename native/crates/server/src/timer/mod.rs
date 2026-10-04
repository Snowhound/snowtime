use crate::entries::schemas::Entry;
use crate::schemas::MAX_ENTRY_MS;
pub mod routes;
pub mod schemas;
// The running timer: a time entry with stopped_at NULL (src/server/timer/timer.server.ts).
// At most one per user across all organizations; the partial unique index
// time_entry_one_running backs this up. The functions here see only entries in
// organizations the user still belongs to.
use self::schemas::{
    RunningTimer, RunningTimerProject, StartTimerInput, StartedTimer, StopTimerInput,
};
use crate::{Code, Error, Key, Result, Timestamp, clock, refuse};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};

use crate::entries::{assert_entry_room, entry_columns, entry_of};
use crate::projects::assert_usable_project;
use crate::queries::failed_constraint;
use crate::scope::Scope;

fn running_of(user_id: &str) -> crate::queries::Sql {
    crate::sql!(
        "user_id = ",
        user_id,
        " and stopped_at is null and sys_deleted = 0"
    )
}
fn is_member_of_entry_organization(user_id: &str) -> crate::queries::Sql {
    crate::sql!(
        "exists (select 1 from member where member.organization_id = time_entry.organization_id and member.user_id = ",
        user_id,
        ")"
    )
}

fn stop_running(
    db: &Connection,
    user_id: &str,
    now: i64,
    id: Option<&str>,
) -> Result<Option<Entry>> {
    // A timer ends at least 1 ms after its start and at most MAX_ENTRY_MS later.
    let stop_at = crate::sql!(
        "min(max(",
        now,
        ", started_at + 1), started_at + ",
        MAX_ENTRY_MS,
        ")"
    );
    let stopped = crate::sql!(
        "update time_entry set stopped_at = ",
        stop_at,
        ", updated_at = ",
        now,
        ", updated_by = ",
        user_id,
        " where ",
        running_of(user_id),
        " and ",
        is_member_of_entry_organization(user_id),
        " and (",
        id,
        " is null or id = ",
        id,
        ") returning ",
        entry_columns()
    )
    .query_row(db, entry_of)
    .optional()?;
    Ok(stopped)
}

// The scope was resolved before start_timer's transaction. A member removed since would get
// a timer the removal hook has already missed, running on in an organization they left.
fn assert_still_member(tx: &Connection, scope: &Scope) -> Result<()> {
    let membership: Option<String> = crate::sql!(
        "select id from member where organization_id = ",
        &scope.organization_id,
        " and user_id = ",
        &scope.user_id
    )
    .query_row(tx, |row| row.get(0))
    .optional()?;
    if membership.is_none() {
        return refuse(Code::Forbidden, Key::NotOrganizationMember);
    }
    Ok(())
}

// Starts a timer in the scope's organization. A running timer, in any organization, is
// stopped first in the same transaction.
pub fn start_timer(db: &Connection, scope: &Scope, input: StartTimerInput) -> Result<StartedTimer> {
    let now = clock::now();
    let started = (|| {
        let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
        // The stop goes with the checks; a failed check rolls it back.
        assert_still_member(&tx, scope)?;
        if let Some(project_id) = &input.project_id {
            assert_usable_project(&tx, scope, project_id)?;
        }
        assert_entry_room(
            &tx,
            &scope.organization_id,
            &scope.user_id,
            Timestamp(now),
            None,
        )?;
        let stopped = stop_running(&tx, &scope.user_id, now, None)?;
        let started = crate::sql!("insert into time_entry (id, organization_id, user_id, project_id, description, ticket, started_at, created_by, updated_by) values (",
            input.id, ", ", &scope.organization_id, ", ", &scope.user_id, ", ", input.project_id,
            ", ", input.description, ", ", input.ticket, ", ", now, ", ", &scope.user_id, ", ", &scope.user_id,
            ") returning ", entry_columns()).query_row(&tx, entry_of)?;
        tx.commit()?;
        Ok(StartedTimer { started, stopped })
    })();
    let Err(Error::Database(error)) = started else {
        return started;
    };
    match failed_constraint(&error) {
        Some("time_entry.user_id") => {
            let left: Option<String> = crate::sql!(
                "select id from time_entry where ",
                running_of(&scope.user_id),
                " and not ",
                is_member_of_entry_organization(&scope.user_id)
            )
            .query_row(db, |row| row.get(0))
            .optional()?;
            // A timer the removal hook failed to stop blocks every new one; say so.
            let key = if left.is_some() {
                Key::TimerRunningInLeftOrganization
            } else {
                Key::TimerStartedElsewhere
            };
            refuse(Code::Conflict, key)
        }
        Some("time_entry.id") => refuse(Code::Conflict, Key::EntryIdTaken),
        Some("time_entry_live_project") => refuse(Code::NotFound, Key::ProjectNotFound),
        _ => Err(error.into()),
    }
}

// Stops the user's running timer if it is the given entry. The entry may belong to any of
// the user's organizations.
pub fn stop_timer(db: &Connection, user_id: &str, input: StopTimerInput) -> Result<Entry> {
    match stop_running(db, user_id, clock::now(), Some(&input.id))? {
        Some(stopped) => Ok(stopped),
        None => refuse(Code::NotFound, Key::TimerNotRunning),
    }
}

// The user's running timer in any organization, with its project, or None.
pub fn get_running_timer(db: &Connection, user_id: &str) -> Result<Option<RunningTimer>> {
    let running = crate::sql!("select time_entry.id, time_entry.organization_id, time_entry.user_id, time_entry.project_id, time_entry.description, time_entry.ticket, time_entry.started_at, time_entry.stopped_at, project.id, project.name, project.color from time_entry left join project on project.id = time_entry.project_id where time_entry.user_id = ",
        user_id, " and time_entry.stopped_at is null and time_entry.sys_deleted = 0 and ",
        is_member_of_entry_organization(user_id), " limit 1")
        .query_row(db, |row| {
            let project = match row.get::<_, Option<String>>(8)? {
                Some(id) => Some(RunningTimerProject {
                    id,
                    name: row.get(9)?,
                    color: row.get(10)?,
                }),
                None => None,
            };
            Ok(RunningTimer {
                entry: entry_of(row)?,
                project,
            })
        })
        .optional()?;
    Ok(running)
}
