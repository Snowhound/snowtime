//! Time entries in the scope's organization (src/server/entries/entries.server.ts).
//! Everyone writes their own entries; admins and owners also write other members' entries;
//! team leads only read their teams' entries.
use rusqlite::{Connection, Row};
use sea_query::{Cond, Expr, ExprTrait, Func, Order, Query, UpdateStatement};
use snowtime_core::schemas::{
    CreateEntryInput, DeleteEntryInput, DeletedEntry, Entry, GetFirstEntryStartInput,
    ListEntriesInput, MAX_ENTRY_MS, Patch, UpdateEntryInput,
};
use snowtime_core::{Code, Key, Result, Timestamp, clock, refuse};

use crate::projects::assert_usable_project;
use crate::queries::{all, failed_constraint, first, live_entry, run};
use crate::schema::{Member, TimeEntry};
use crate::scope::{Scope, is_admin, readable_user_ids};

// The columns the contract returns for an entry, in Entry's order.
pub const ENTRY_COLUMNS: [(TimeEntry, TimeEntry); 8] = [
    (TimeEntry::Table, TimeEntry::Id),
    (TimeEntry::Table, TimeEntry::OrganizationId),
    (TimeEntry::Table, TimeEntry::UserId),
    (TimeEntry::Table, TimeEntry::ProjectId),
    (TimeEntry::Table, TimeEntry::Description),
    (TimeEntry::Table, TimeEntry::Ticket),
    (TimeEntry::Table, TimeEntry::StartedAt),
    (TimeEntry::Table, TimeEntry::StoppedAt),
];

pub fn entry_of(row: &Row) -> rusqlite::Result<Entry> {
    Ok(Entry {
        id: row.get(0)?,
        organization_id: row.get(1)?,
        user_id: row.get(2)?,
        project_id: row.get(3)?,
        description: row.get(4)?,
        ticket: row.get(5)?,
        started_at: row.get(6)?,
        stopped_at: row.get(7)?,
    })
}

// A member's entries in one organization that start within a day of a new entry's start
// (limits.entriesPerMemberPerDay).
const ENTRIES_PER_MEMBER_PER_DAY: i64 = 200;
const DAY: i64 = 24 * 60 * 60 * 1000;

fn assert_can_write(scope: &Scope, user_id: &str) -> Result<()> {
    if user_id != scope.user_id && !is_admin(scope) {
        return refuse(Code::Forbidden, Key::EntryForbidden);
    }
    Ok(())
}

// An admin writing another user's entry: that user must be in the organization.
fn assert_member(db: &Connection, scope: &Scope, user_id: &str) -> Result<()> {
    let membership: Option<String> = first(
        db,
        Query::select()
            .column(Member::Id)
            .from(Member::Table)
            .and_where(Expr::col(Member::OrganizationId).eq(&scope.organization_id))
            .and_where(Expr::col(Member::UserId).eq(user_id)),
        |row| row.get(0),
    )?;
    if membership.is_none() {
        return refuse(Code::NotFound, Key::MemberNotFound);
    }
    Ok(())
}

fn find_entry(db: &Connection, scope: &Scope, id: &str) -> Result<Entry> {
    let entry = first(
        db,
        Query::select()
            .columns(ENTRY_COLUMNS)
            .from(TimeEntry::Table)
            .and_where(Expr::col(TimeEntry::Id).eq(id))
            .cond_where(live_entry(&scope.organization_id)),
        entry_of,
    )?;
    entry.map_or_else(|| refuse(Code::NotFound, Key::EntryNotFound), Ok)
}

// Refuses a new entry when the user already has the limit's entries in the organization
// starting within a day of it. Moving an entry checks the same, without counting the entry
// itself. The (organization_id, user_id, started_at) index makes this one short range read.
pub fn assert_entry_room(
    db: &Connection,
    organization_id: &str,
    user_id: &str,
    started_at: Timestamp,
    moving_id: Option<&str>,
) -> Result<()> {
    let total: i64 = first(
        db,
        Query::select()
            .expr(Func::count(Expr::cust("*")))
            .from(TimeEntry::Table)
            .cond_where(live_entry(organization_id))
            .and_where(Expr::col(TimeEntry::UserId).eq(user_id))
            .and_where(Expr::col(TimeEntry::StartedAt).gt(started_at.0 - DAY))
            .and_where(Expr::col(TimeEntry::StartedAt).lt(started_at.0 + DAY))
            .and_where_option(moving_id.map(|id| Expr::col(TimeEntry::Id).ne(id))),
        |row| row.get(0),
    )?
    .unwrap_or(0);
    if total >= ENTRIES_PER_MEMBER_PER_DAY {
        return refuse(Code::LimitReached, Key::EntryLimit);
    }
    Ok(())
}

pub fn create_entry(db: &Connection, scope: &Scope, input: CreateEntryInput) -> Result<Entry> {
    let user_id = input.user_id.as_deref().unwrap_or(&scope.user_id);
    assert_can_write(scope, user_id)?;
    if user_id != scope.user_id {
        assert_member(db, scope, user_id)?;
    }
    if let Some(project_id) = &input.project_id {
        assert_usable_project(db, scope, project_id)?;
    }
    assert_entry_room(db, &scope.organization_id, user_id, input.started_at, None)?;

    let inserted = first(
        db,
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
                TimeEntry::StoppedAt,
                TimeEntry::CreatedBy,
                TimeEntry::UpdatedBy,
            ])
            .values_panic([
                input.id.into(),
                scope.organization_id.clone().into(),
                user_id.into(),
                input.project_id.clone().into(),
                input.description.into(),
                input.ticket.into(),
                input.started_at.0.into(),
                input.stopped_at.0.into(),
                scope.user_id.clone().into(),
                scope.user_id.clone().into(),
            ])
            .returning(Query::returning().columns(ENTRY_COLUMNS)),
        entry_of,
    );
    match inserted {
        Ok(entry) => Ok(entry.expect("an insert returns its row")),
        Err(error) => match failed_constraint(&error) {
            Some("time_entry.id") => refuse(Code::Conflict, Key::EntryIdTaken),
            // Deleted since assert_usable_project found it.
            Some("time_entry_live_project") => refuse(Code::NotFound, Key::ProjectNotFound),
            _ => Err(error.into()),
        },
    }
}

// Sets the column when the patch has it: to its value, or to NULL.
fn set<T: Into<sea_query::Value>>(
    update: &mut UpdateStatement,
    column: TimeEntry,
    patch: Patch<T>,
) {
    match patch {
        Patch::Absent => {}
        Patch::Null => {
            update.value(column, Expr::cust("NULL"));
        }
        Patch::Value(value) => {
            update.value(column, value.into());
        }
    }
}

// Updates the fields present in input. A running entry keeps running: stop it with
// stop_timer, not by setting stoppedAt here.
pub fn update_entry(db: &Connection, scope: &Scope, input: UpdateEntryInput) -> Result<Entry> {
    let entry = find_entry(db, scope, &input.id)?;
    assert_can_write(scope, &entry.user_id)?;

    if input.stopped_at.value().is_some() && entry.stopped_at.is_none() {
        return refuse(Code::Invalid, Key::EntryRunning);
    }
    let started_at = input
        .started_at
        .value()
        .copied()
        .unwrap_or(entry.started_at);
    let stopped_at = input.stopped_at.value().copied().or(entry.stopped_at);
    if let Some(stopped_at) = stopped_at {
        if stopped_at <= started_at {
            return refuse(Code::Invalid, Key::EntryEndBeforeStart);
        }
        if stopped_at.0 - started_at.0 > MAX_ENTRY_MS {
            return refuse(Code::Invalid, Key::EntryTooLong);
        }
    }
    // Keeping an archived project is fine; moving time onto one is not.
    if let Some(project_id) = input.project_id.value()
        && entry.project_id.as_ref() != Some(project_id)
    {
        assert_usable_project(db, scope, project_id)?;
    }
    if let Some(&new_start) = input.started_at.value()
        && new_start != entry.started_at
    {
        assert_entry_room(
            db,
            &scope.organization_id,
            &entry.user_id,
            new_start,
            Some(&entry.id),
        )?;
    }

    // The checks above read the entry before the update, so a concurrent edit can still
    // break them; the database refuses all three (time_entry_stopped_after_started,
    // time_entry_max_length, time_entry_live_project).
    let mut update = Query::update();
    update.table(TimeEntry::Table);
    set(&mut update, TimeEntry::ProjectId, input.project_id);
    set(&mut update, TimeEntry::Description, input.description);
    set(&mut update, TimeEntry::Ticket, input.ticket);
    set(
        &mut update,
        TimeEntry::StartedAt,
        input.started_at.map(|t| t.0),
    );
    set(
        &mut update,
        TimeEntry::StoppedAt,
        input.stopped_at.map(|t| t.0),
    );
    update
        .value(TimeEntry::UpdatedAt, clock::now())
        .value(TimeEntry::UpdatedBy, &scope.user_id)
        .and_where(Expr::col(TimeEntry::Id).eq(&entry.id))
        .cond_where(live_entry(&scope.organization_id))
        .returning(Query::returning().columns(ENTRY_COLUMNS));
    match first(db, &update, entry_of) {
        Ok(Some(entry)) => Ok(entry),
        Ok(None) => refuse(Code::NotFound, Key::EntryNotFound),
        Err(error) => match failed_constraint(&error) {
            Some("time_entry_stopped_after_started") => {
                refuse(Code::Invalid, Key::EntryEndBeforeStart)
            }
            Some("time_entry_max_length") => refuse(Code::Invalid, Key::EntryTooLong),
            Some("time_entry_live_project") => refuse(Code::NotFound, Key::ProjectNotFound),
            _ => Err(error.into()),
        },
    }
}

// Logical delete: the row stays, with sys_deleted set and updated_by recording who.
pub fn delete_entry(
    db: &Connection,
    scope: &Scope,
    input: DeleteEntryInput,
) -> Result<DeletedEntry> {
    let entry = find_entry(db, scope, &input.id)?;
    assert_can_write(scope, &entry.user_id)?;
    run(
        db,
        Query::update()
            .table(TimeEntry::Table)
            .value(TimeEntry::SysDeleted, true)
            .value(TimeEntry::UpdatedAt, clock::now())
            .value(TimeEntry::UpdatedBy, &scope.user_id)
            .and_where(Expr::col(TimeEntry::Id).eq(&entry.id))
            .cond_where(live_entry(&scope.organization_id)),
    )?;
    Ok(DeletedEntry { id: entry.id })
}

fn assert_readable(db: &Connection, scope: &Scope, user_id: &str) -> Result<()> {
    if let Some(readable) = readable_user_ids(db, scope)?
        && !readable.iter().any(|id| id == user_id)
    {
        return refuse(Code::Forbidden, Key::EntriesForbidden);
    }
    Ok(())
}

// When the user's earliest entry in the organization started, or None without entries.
pub fn get_first_entry_start(
    db: &Connection,
    scope: &Scope,
    input: GetFirstEntryStartInput,
) -> Result<Option<Timestamp>> {
    assert_readable(db, scope, &input.user_id)?;
    let first_start = first(
        db,
        Query::select()
            .expr(Func::min(Expr::col(TimeEntry::StartedAt)))
            .from(TimeEntry::Table)
            .cond_where(live_entry(&scope.organization_id))
            .and_where(Expr::col(TimeEntry::UserId).eq(&input.user_id)),
        |row| row.get(0),
    )?;
    Ok(first_start.flatten())
}

// Entries overlapping [from, to), newest first, including a running one. Members see their
// own; team leads also their teams' members'; admins and owners everyone's.
pub fn list_entries(db: &Connection, scope: &Scope, input: ListEntriesInput) -> Result<Vec<Entry>> {
    let readable = readable_user_ids(db, scope)?;
    if let (Some(user_id), Some(readable)) = (&input.user_id, &readable)
        && !readable.contains(user_id)
    {
        return refuse(Code::Forbidden, Key::EntriesForbidden);
    }
    let users = input.user_id.map(|id| vec![id]).or(readable);

    let entries = all(
        db,
        Query::select()
            .columns(ENTRY_COLUMNS)
            .from(TimeEntry::Table)
            .cond_where(live_entry(&scope.organization_id))
            .and_where_option(users.map(|users| Expr::col(TimeEntry::UserId).is_in(users)))
            .and_where(Expr::col(TimeEntry::StartedAt).gt(input.from.0 - MAX_ENTRY_MS))
            .and_where(Expr::col(TimeEntry::StartedAt).lt(input.to.0))
            .cond_where(
                Cond::any()
                    .add(Expr::col(TimeEntry::StoppedAt).is_null())
                    .add(Expr::col(TimeEntry::StoppedAt).gt(input.from.0)),
            )
            .order_by(TimeEntry::StartedAt, Order::Desc),
        entry_of,
    )?;
    Ok(entries)
}
