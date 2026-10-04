pub mod routes;

pub fn database_available(db: &rusqlite::Connection) -> bool {
    db.query_row("select 1", [], |_| Ok(())).is_ok()
}
