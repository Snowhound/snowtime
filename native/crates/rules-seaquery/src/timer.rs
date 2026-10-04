//! The running timer: a time entry with stopped_at NULL (src/server/timer/timer.server.ts).
//! At most one per user across all organizations; the partial unique index
//! time_entry_one_running backs this up. The functions here see only entries in
//! organizations the user still belongs to.
use rusqlite::{Connection, Transaction, TransactionBehavior};
use sea_query::{Cond, Expr, ExprTrait, Query};
use snowtime_core::schemas::{
    Entry, MAX_ENTRY_MS, RunningTimer, RunningTimerProject, StartTimerInput, StartedTimer,
    StopTimerInput,
};
use snowtime_core::{Code, Error, Key, Result, Timestamp, clock, refuse};

use crate::entries::{ENTRY_COLUMNS, assert_entry_room, entry_of};
use crate::projects::assert_usable_project;
use crate::queries::{failed_constraint, first, not_deleted};
use crate::schema::{Member, Project, TimeEntry};
use crate::scope::Scope;

fn running_of(user_id: &str) -> Cond {
    Cond::all()
        .add(Expr::col((TimeEntry::Table, TimeEntry::UserId)).eq(user_id))
        .add(Expr::col((TimeEntry::Table, TimeEntry::StoppedAt)).is_null())
        .add(not_deleted((TimeEntry::Table, TimeEntry::SysDeleted)))
}

fn is_member_of_entry_organization(user_id: &str) -> Expr {
    Expr::exists(
        Query::select()
            .expr(Expr::val(1))
            .from(Member::Table)
            .and_where(
                Expr::col((Member::Table, Member::OrganizationId))
                    .equals((TimeEntry::Table, TimeEntry::OrganizationId)),
            )
            .and_where(Expr::col((Member::Table, Member::UserId)).eq(user_id))
            .take(),
    )
}

// stopped_at must be after started_at; a timer stopped within its first millisecond (or
// started ahead of this server's clock) ends one millisecond after it started. A timer left
// running past MAX_ENTRY_HOURS ends there.
fn stop_at(now: i64) -> Expr {
    Expr::cust_with_values(
        "min(max(?, \"started_at\" + 1), \"started_at\" + ?)",
        [now, MAX_ENTRY_MS],
    )
}

fn stop_running(
    db: &Connection,
    user_id: &str,
    now: i64,
    id: Option<&str>,
) -> Result<Option<Entry>> {
    let stopped = first(
        db,
        Query::update()
            .table(TimeEntry::Table)
            .value(TimeEntry::StoppedAt, stop_at(now))
            .value(TimeEntry::UpdatedAt, now)
            .value(TimeEntry::UpdatedBy, user_id)
            .cond_where(running_of(user_id))
            .and_where(is_member_of_entry_organization(user_id))
            .and_where_option(id.map(|id| Expr::col((TimeEntry::Table, TimeEntry::Id)).eq(id)))
            .returning(Query::returning().columns(ENTRY_COLUMNS)),
        entry_of,
    )?;
    Ok(stopped)
}

// The scope was resolved before start_timer's transaction. A member removed since would get
// a timer the removal hook has already missed, running on in an organization they left.
fn assert_still_member(tx: &Connection, scope: &Scope) -> Result<()> {
    let membership: Option<String> = first(
        tx,
        Query::select()
            .column(Member::Id)
            .from(Member::Table)
            .and_where(Expr::col(Member::OrganizationId).eq(&scope.organization_id))
            .and_where(Expr::col(Member::UserId).eq(&scope.user_id)),
        |row| row.get(0),
    )?;
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
        let started = first(
            &tx,
            Query::insert()
                .into_table(TimeEntry::Table)
                .columns([
                    TimeEntry::Id,
                    TimeEntry::OrganizationId,
                    TimeEntry::UserId,
                    TimeEntry::ProjectId,
                    TimeEntry::Description,
                    TimeEntry::Ticket,
                    TimeEntry::StartedAt,
                    TimeEntry::CreatedBy,
                    TimeEntry::UpdatedBy,
                ])
                .values_panic([
                    input.id.clone().into(),
                    scope.organization_id.clone().into(),
                    scope.user_id.clone().into(),
                    input.project_id.clone().into(),
                    input.description.clone().into(),
                    input.ticket.clone().into(),
                    now.into(),
                    scope.user_id.clone().into(),
                    scope.user_id.clone().into(),
                ])
                .returning(Query::returning().columns(ENTRY_COLUMNS)),
            entry_of,
        )?
        .expect("an insert returns its row");
        tx.commit()?;
        Ok(StartedTimer { started, stopped })
    })();
    let Err(Error::Database(error)) = started else {
        return started;
    };
    match failed_constraint(&error) {
        Some("time_entry.user_id") => {
            let left: Option<String> = first(
                db,
                Query::select()
                    .column(TimeEntry::Id)
                    .from(TimeEntry::Table)
                    .cond_where(running_of(&scope.user_id))
                    .and_where(is_member_of_entry_organization(&scope.user_id).not()),
                |row| row.get(0),
            )?;
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
    let running = first(
        db,
        Query::select()
            .columns(ENTRY_COLUMNS)
            .columns([
                (Project::Table, Project::Id),
                (Project::Table, Project::Name),
                (Project::Table, Project::Color),
            ])
            .from(TimeEntry::Table)
            .left_join(
                Project::Table,
                Expr::col((Project::Table, Project::Id))
                    .equals((TimeEntry::Table, TimeEntry::ProjectId)),
            )
            .cond_where(running_of(user_id))
            .and_where(is_member_of_entry_organization(user_id))
            .limit(1),
        |row| {
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
        },
    )?;
    Ok(running)
}
