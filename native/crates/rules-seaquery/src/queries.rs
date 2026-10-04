//! Shared query helpers (src/server/queries.server.ts), and running a built statement on
//! rusqlite.
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension, Row, params_from_iter};
use sea_query::{Cond, Expr, ExprTrait, IntoColumnRef, SqliteQueryBuilder, Value, Values};

use crate::schema::TimeEntry;

/// A statement SeaQuery can build.
pub trait Statement {
    fn sql(&self) -> (String, Values);
}

macro_rules! statement {
    ($($t:ty),*) => {$(
        impl Statement for $t {
            fn sql(&self) -> (String, Values) {
                self.build(SqliteQueryBuilder)
            }
        }
    )*};
}
statement!(
    sea_query::SelectStatement,
    sea_query::InsertStatement,
    sea_query::UpdateStatement,
    sea_query::DeleteStatement
);

fn bind(value: Value) -> SqlValue {
    match value {
        Value::Bool(v) => v.map_or(SqlValue::Null, |b| SqlValue::Integer(b.into())),
        Value::Int(v) => v.map_or(SqlValue::Null, |n| SqlValue::Integer(n.into())),
        Value::BigInt(v) => v.map_or(SqlValue::Null, SqlValue::Integer),
        Value::Unsigned(v) => v.map_or(SqlValue::Null, |n| SqlValue::Integer(n.into())),
        // LIMIT and OFFSET bind as u64.
        Value::BigUnsigned(v) => v.map_or(SqlValue::Null, |n| {
            SqlValue::Integer(i64::try_from(n).expect("an integer SQLite holds"))
        }),
        Value::String(v) => v.map_or(SqlValue::Null, SqlValue::Text),
        Value::Bytes(v) => v.map_or(SqlValue::Null, SqlValue::Blob),
        other => unimplemented!("binding {other:?}"),
    }
}

fn prepared<'c>(
    db: &'c Connection,
    statement: &impl Statement,
) -> rusqlite::Result<(rusqlite::CachedStatement<'c>, Vec<SqlValue>)> {
    let (sql, values) = statement.sql();
    Ok((
        db.prepare_cached(&sql)?,
        values.0.into_iter().map(bind).collect(),
    ))
}

/// The first row, or None.
pub fn first<T>(
    db: &Connection,
    statement: &impl Statement,
    row: impl FnOnce(&Row) -> rusqlite::Result<T>,
) -> rusqlite::Result<Option<T>> {
    let (mut prepared, values) = prepared(db, statement)?;
    prepared.query_row(params_from_iter(values), row).optional()
}

pub fn all<T>(
    db: &Connection,
    statement: &impl Statement,
    row: impl FnMut(&Row) -> rusqlite::Result<T>,
) -> rusqlite::Result<Vec<T>> {
    let (mut prepared, values) = prepared(db, statement)?;
    prepared.query_map(params_from_iter(values), row)?.collect()
}

pub fn run(db: &Connection, statement: &impl Statement) -> rusqlite::Result<usize> {
    let (mut prepared, values) = prepared(db, statement)?;
    prepared.execute(params_from_iter(values))
}

/// A literal 0, not a bound parameter: SQLite uses a partial index (WHERE sys_deleted = 0)
/// only when it can prove the query matches it.
pub fn not_deleted(column: impl IntoColumnRef) -> Expr {
    Expr::col(column).eq(Expr::cust("0"))
}

/// Entries of the organization that are not deleted.
pub fn live_entry(organization_id: &str) -> Cond {
    Cond::all()
        .add(Expr::col((TimeEntry::Table, TimeEntry::OrganizationId)).eq(organization_id))
        .add(not_deleted((TimeEntry::Table, TimeEntry::SysDeleted)))
}

/// The failed constraint of a SQLite constraint violation, such as "time_entry.user_id" for
/// a unique index, or None for any other error.
pub fn failed_constraint(error: &rusqlite::Error) -> Option<&str> {
    match error {
        rusqlite::Error::SqliteFailure(_, Some(message)) => message
            .split_once("constraint failed: ")
            .map(|(_, name)| name),
        _ => None,
    }
}
