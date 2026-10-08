//! Composable SQL: literals are text, fragments splice, and values bind in order.
use crate::schemas::Patch;
use rusqlite::types::{ToSqlOutput, Value};
use rusqlite::{CachedStatement, Connection, ToSql, params_from_iter};

#[derive(Default, Clone, Debug)]
pub struct Sql {
    text: String,
    values: Vec<Value>,
}
impl Sql {
    pub fn text(&self) -> &str {
        &self.text
    }
    pub fn values(&self) -> &[Value] {
        &self.values
    }
    pub fn params(&self) -> impl rusqlite::Params {
        params_from_iter(&self.values)
    }
    pub fn prepare<'a>(&self, db: &'a Connection) -> rusqlite::Result<CachedStatement<'a>> {
        db.prepare_cached(&self.text)
    }
    pub fn query_row<T>(
        &self,
        db: &Connection,
        row: impl FnOnce(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    ) -> rusqlite::Result<T> {
        self.prepare(db)?.query_row(self.params(), row)
    }
    pub fn query<T>(
        &self,
        db: &Connection,
        row: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    ) -> rusqlite::Result<Vec<T>> {
        self.prepare(db)?.query_map(self.params(), row)?.collect()
    }
    pub fn execute(&self, db: &Connection) -> rusqlite::Result<usize> {
        self.prepare(db)?.execute(self.params())
    }
    #[doc(hidden)]
    pub fn push(&mut self, part: impl Part) {
        part.append(self);
    }
    #[doc(hidden)]
    pub fn literal(&mut self, literal: impl Literal) {
        literal.append_literal(self);
    }
}
fn value(value: &impl ToSql) -> Value {
    match value.to_sql().expect("SQL parameters encode") {
        ToSqlOutput::Borrowed(v) => v.try_into().expect("SQL text is UTF-8"),
        ToSqlOutput::Owned(v) => v,
        _ => panic!("SQL fragments accept scalar parameters"),
    }
}
#[doc(hidden)]
pub trait Part {
    fn append(self, sql: &mut Sql);
}
impl<T: ToSql> Part for T {
    fn append(self, sql: &mut Sql) {
        sql.text.push('?');
        sql.values.push(value(&self));
    }
}
impl Part for Sql {
    fn append(self, sql: &mut Sql) {
        sql.text.push_str(&self.text);
        sql.values.extend(self.values);
    }
}
impl Part for &Sql {
    fn append(self, sql: &mut Sql) {
        sql.text.push_str(&self.text);
        sql.values.extend_from_slice(&self.values);
    }
}
#[doc(hidden)]
pub trait Literal {
    fn append_literal(self, sql: &mut Sql);
}
impl Literal for &str {
    fn append_literal(self, sql: &mut Sql) {
        sql.text.push_str(self);
    }
}
macro_rules! bound_literals {
    ($($t:ty),*) => { $(impl Literal for $t { fn append_literal(self, sql: &mut Sql) { sql.push(self); } })* };
}
bound_literals!(i8, i16, i32, i64, u8, u16, u32, f32, f64, bool);

/// Compose comma-separated SQL literals, expressions to bind, and Sql fragments.
/// `sql!("select * from entry where user_id = ", user_id, " and id in ", list(&ids))`.
#[macro_export]
macro_rules! sql {
    (@parts $sql:ident;) => {};
    (@parts $sql:ident; $text:literal $(, $($rest:tt)*)?) => {
        $sql.literal($text); $crate::sql!(@parts $sql; $($($rest)*)?);
    };
    (@parts $sql:ident; $value:expr $(, $($rest:tt)*)?) => {
        $sql.push($value); $crate::sql!(@parts $sql; $($($rest)*)?);
    };
    ($($parts:tt)*) => {{ let mut sql = $crate::queries::Sql::default(); $crate::sql!(@parts sql; $($parts)*); sql }};
}

/// A parenthesized bound list. SQLite's empty IN list matches no rows.
pub fn list<T: ToSql>(values: &[T]) -> Sql {
    let mut sql = Sql {
        text: "(".into(),
        values: Vec::with_capacity(values.len()),
    };
    for (i, v) in values.iter().enumerate() {
        if i > 0 {
            sql.text.push_str(", ");
        }
        sql.push(v);
    }
    sql.text.push(')');
    sql
}
#[derive(Default)]
pub struct Assignments(Sql);
impl Assignments {
    pub fn set_optional<T: ToSql>(&mut self, column: &'static str, value: Option<T>) {
        self.set(column, value.map_or(Patch::Absent, Patch::Value));
    }
    pub fn set<T: ToSql>(&mut self, column: &'static str, patch: Patch<T>) {
        let v = match patch {
            Patch::Absent => return,
            Patch::Null => Value::Null,
            Patch::Value(v) => value(&v),
        };
        if !self.0.text.is_empty() {
            self.0.text.push_str(", ");
        }
        self.0.text.push_str(column);
        self.0.text.push_str(" = ?");
        self.0.values.push(v);
    }
    pub fn finish(self) -> Sql {
        self.0
    }
}

pub fn failed_constraint(error: &rusqlite::Error) -> Option<&str> {
    match error {
        rusqlite::Error::SqliteFailure(_, Some(message)) => message
            .split_once("constraint failed: ")
            .map(|(_, name)| name),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binds_values_and_splices_nested_fragments() {
        let hostile = "'); drop table user; --";
        let condition = crate::sql!("name = ", hostile, " and id in ", list(&[2, 3]));
        let query = crate::sql!("select ", 1, " where ", condition);
        assert_eq!(query.text(), "select ? where name = ? and id in (?, ?)");
        assert_eq!(
            query.values(),
            &[
                Value::Integer(1),
                Value::Text(hostile.into()),
                Value::Integer(2),
                Value::Integer(3)
            ]
        );
        let db = Connection::open_in_memory().unwrap();
        let query = crate::sql!("select ", hostile, " where ", 2, " in ", list(&[2, 3]));
        assert_eq!(
            query
                .prepare(&db)
                .unwrap()
                .query_row(query.params(), |row| row.get::<_, String>(0))
                .unwrap(),
            hostile
        );
        let empty = crate::sql!("select 1 where 1 in ", list::<i64>(&[]));
        assert!(
            empty
                .prepare(&db)
                .unwrap()
                .query_row(empty.params(), |_| Ok(()))
                .is_err()
        );
    }
    #[test]
    fn assignments_preserve_absent_null_and_value() {
        let mut assignments = Assignments::default();
        assignments.set("absent", Patch::<String>::Absent);
        assignments.set("removed", Patch::<String>::Null);
        assignments.set("name", Patch::Value("new"));
        let fragment = assignments.finish();
        assert_eq!(fragment.text(), "removed = ?, name = ?");
        assert_eq!(fragment.values(), &[Value::Null, Value::Text("new".into())]);
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("create table item (id integer, absent text, removed text, name text); insert into item values (1, 'kept', 'old', 'old')").unwrap();
        let query = crate::sql!(
            "update item set ",
            fragment,
            " where id = ",
            1,
            " returning absent, removed, name"
        );
        let row = query
            .prepare(&db)
            .unwrap()
            .query_row(query.params(), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .unwrap();
        assert_eq!(row, ("kept".into(), None, "new".into()));
    }
}
