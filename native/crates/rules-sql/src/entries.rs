//! Time entries in the scope's organization (src/server/entries/entries.server.ts).
//! Everyone writes their own entries; admins and owners also write other members' entries;
//! team leads only read their teams' entries.
use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, Row, params, params_from_iter};
use snowtime_core::schemas::{
    CreateEntryInput, DeleteEntryInput, DeletedEntry, Entry, GetFirstEntryStartInput,
    ListEntriesInput, MAX_ENTRY_MS, Patch, UpdateEntryInput,
};
use snowtime_core::{Code, Error, Key, Result, Timestamp, clock, refuse};

use crate::projects::assert_usable_project;
use crate::queries::{failed_constraint, in_list};
use crate::scope::{Scope, is_admin, readable_user_ids};

// The columns the contract returns for an entry, in Entry's order.
pub const ENTRY_COLUMNS: &str =
    "id, organization_id, user_id, project_id, description, ticket, started_at, stopped_at";

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
    let membership: Option<String> = db
        .prepare_cached("select id from member where organization_id = ?1 and user_id = ?2")?
        .query_row(params![scope.organization_id, user_id], |row| row.get(0))
        .optional()?;
    if membership.is_none() {
        return refuse(Code::NotFound, Key::MemberNotFound);
    }
    Ok(())
}

fn find_entry(db: &Connection, scope: &Scope, id: &str) -> Result<Entry> {
    let entry = db
        .prepare_cached(&format!(
            "select {ENTRY_COLUMNS} from time_entry
             where id = ?1 and organization_id = ?2 and sys_deleted = 0"
        ))?
        .query_row(params![id, scope.organization_id], entry_of)
        .optional()?;
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
    let total: i64 = db
        .prepare_cached(
            "select count(*) from time_entry
             where organization_id = ?1 and sys_deleted = 0 and user_id = ?2
               and started_at > ?3 and started_at < ?4 and (?5 is null or id <> ?5)",
        )?
        .query_row(
            params![
                organization_id,
                user_id,
                started_at.0 - DAY,
                started_at.0 + DAY,
                moving_id
            ],
            |row| row.get(0),
        )?;
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

    let inserted = db
        .prepare_cached(&format!(
            "insert into time_entry (id, organization_id, user_id, project_id, description,
                                     ticket, started_at, stopped_at, created_by, updated_by)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9) returning {ENTRY_COLUMNS}"
        ))?
        .query_row(
            params![
                input.id,
                scope.organization_id,
                user_id,
                input.project_id,
                input.description,
                input.ticket,
                input.started_at,
                input.stopped_at,
                scope.user_id
            ],
            entry_of,
        );
    match inserted {
        Ok(entry) => Ok(entry),
        Err(error) => match failed_constraint(&error) {
            Some("time_entry.id") => refuse(Code::Conflict, Key::EntryIdTaken),
            // Deleted since assert_usable_project found it.
            Some("time_entry_live_project") => refuse(Code::NotFound, Key::ProjectNotFound),
            _ => Err(error.into()),
        },
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
    let mut sets = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    fn set<T: Into<Value>>(
        sets: &mut Vec<&str>,
        values: &mut Vec<Value>,
        column: &'static str,
        patch: Patch<T>,
    ) {
        match patch {
            Patch::Absent => {}
            Patch::Null => {
                sets.push(column);
                values.push(Value::Null);
            }
            Patch::Value(v) => {
                sets.push(column);
                values.push(v.into());
            }
        }
    }
    set(&mut sets, &mut values, "project_id", input.project_id);
    set(&mut sets, &mut values, "description", input.description);
    set(&mut sets, &mut values, "ticket", input.ticket);
    set(
        &mut sets,
        &mut values,
        "started_at",
        input.started_at.map(|t| t.0),
    );
    set(
        &mut sets,
        &mut values,
        "stopped_at",
        input.stopped_at.map(|t| t.0),
    );
    set(
        &mut sets,
        &mut values,
        "updated_at",
        Patch::Value(clock::now()),
    );
    set(
        &mut sets,
        &mut values,
        "updated_by",
        Patch::Value(scope.user_id.clone()),
    );
    let assignments: Vec<String> = sets.iter().map(|c| format!("{c} = ?")).collect();
    values.push(Value::Text(entry.id.clone()));
    values.push(Value::Text(scope.organization_id.clone()));
    let updated = db
        .prepare(&format!(
            "update time_entry set {} where id = ? and organization_id = ? and sys_deleted = 0
             returning {ENTRY_COLUMNS}",
            assignments.join(", ")
        ))?
        .query_row(params_from_iter(values), entry_of)
        .optional();
    match updated {
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
    db.prepare_cached(
        "update time_entry set sys_deleted = 1, updated_at = ?1, updated_by = ?2
         where id = ?3 and organization_id = ?4 and sys_deleted = 0",
    )?
    .execute(params![
        clock::now(),
        scope.user_id,
        entry.id,
        scope.organization_id
    ])?;
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
    let first = db
        .prepare_cached(
            "select min(started_at) from time_entry
             where organization_id = ?1 and sys_deleted = 0 and user_id = ?2",
        )?
        .query_row(params![scope.organization_id, input.user_id], |row| {
            row.get(0)
        })?;
    Ok(first)
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

    let mut values = vec![Value::Text(scope.organization_id.clone())];
    let users_filter = match &users {
        Some(users) => {
            let (list, ids) = in_list(users);
            values.extend(ids);
            format!("and user_id {list}")
        }
        None => String::new(),
    };
    values.extend([
        Value::Integer(input.from.0 - MAX_ENTRY_MS),
        Value::Integer(input.to.0),
        Value::Integer(input.from.0),
    ]);
    let entries = db
        .prepare_cached(&format!(
            "select {ENTRY_COLUMNS} from time_entry
             where organization_id = ? and sys_deleted = 0 {users_filter}
               and started_at > ? and started_at < ? and (stopped_at is null or stopped_at > ?)
             order by started_at desc"
        ))?
        .query_map(params_from_iter(values), entry_of)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Error::from)?;
    Ok(entries)
}
