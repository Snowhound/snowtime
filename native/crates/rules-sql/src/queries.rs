//! Shared query helpers (src/server/queries.server.ts). Queries write `sys_deleted = 0` as a
//! literal, not a parameter: SQLite uses a partial index only when it can prove the query
//! matches it.
use rusqlite::types::Value;

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

/// `in (?, ?, ...)` for a list, and its values.
pub fn in_list(values: &[String]) -> (String, impl Iterator<Item = Value> + '_) {
    let placeholders = vec!["?"; values.len()].join(", ");
    (
        format!("in ({placeholders})"),
        values.iter().map(|v| Value::Text(v.clone())),
    )
}
