//! Drizzle's migrations, applied and recorded as drizzle-orm's SQLite migrator and
//! scripts/start-self-hosted.ts do, so either backend can migrate a database the other runs.
use crate::timestamp::{Timestamp, days_from_civil};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};
use std::path::Path;

const TABLE: &str = "__drizzle_migrations";

struct Migration {
    name: String,
    sql: String,
    hash: String,
    folder_millis: i64,
}

fn sha256(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

// formatToMillis in drizzle-orm: the folder name's leading yyyyMMddHHmmss, in UTC.
fn folder_millis(name: &str) -> Result<i64, String> {
    let digits = name
        .get(..14)
        .filter(|d| d.bytes().all(|b| b.is_ascii_digit()))
        .ok_or_else(|| format!("{name}: the folder name doesn't start with a timestamp"))?;
    let part = |range: std::ops::Range<usize>| digits[range].parse::<i64>().unwrap();
    let days = days_from_civil(part(0..4), part(4..6), part(6..8));
    Ok(days * 86_400_000 + part(8..10) * 3_600_000 + part(10..12) * 60_000 + part(12..14) * 1000)
}

// readMigrationFiles in drizzle-orm: every subfolder with a migration.sql, by name.
fn read(folder: &Path) -> Result<Vec<Migration>, String> {
    let error = |e: std::io::Error| format!("{}: {e}", folder.display());
    if folder.join("meta/_journal.json").exists() {
        return Err("The migrations folder is in drizzle-kit's old format.".into());
    }
    let mut migrations = Vec::new();
    for entry in std::fs::read_dir(folder).map_err(error)? {
        let entry = entry.map_err(error)?;
        let path = entry.path().join("migration.sql");
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let sql = std::fs::read_to_string(&path).map_err(error)?;
        migrations.push(Migration {
            folder_millis: folder_millis(&name)?,
            hash: sha256(&sql),
            name,
            sql,
        });
    }
    migrations.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(migrations)
}

/// Refuses an applied migration that was edited or deleted since (scripts/db-verify.ts),
/// then applies the pending ones in one transaction. Returns how many it applied.
pub fn migrate(db: &mut Connection, folder: &Path) -> Result<usize, String> {
    let migrations = read(folder)?;
    let sql = |e: rusqlite::Error| e.to_string();
    db.pragma_update(None, "foreign_keys", false).map_err(sql)?;
    let result = apply(db, &migrations);
    db.pragma_update(None, "foreign_keys", true).map_err(sql)?;
    result
}

fn apply(db: &mut Connection, migrations: &[Migration]) -> Result<usize, String> {
    let sql = |e: rusqlite::Error| e.to_string();
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql)?;
    let exists = tx
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = ?",
            [TABLE],
            |_| Ok(()),
        )
        .optional()
        .map_err(sql)?
        .is_some();
    if exists {
        let named = tx
            .query_row(
                &format!("select count(*) from pragma_table_info('{TABLE}') where name = 'name'"),
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(sql)?;
        if named == 0 {
            return Err(format!(
                "{TABLE} predates drizzle-kit's named migrations; run bun run db:migrate once."
            ));
        }
    } else {
        // drizzle-orm's text, whitespace included, so both backends leave the same schema.
        tx.execute_batch(&format!(
            "CREATE TABLE \"{TABLE}\" (\n\t\t\tid INTEGER PRIMARY KEY,\n\t\t\thash text NOT NULL,\
             \n\t\t\tcreated_at numeric,\n\t\t\tname text,\n\t\t\tapplied_at TEXT\n\t\t)"
        ))
        .map_err(sql)?;
    }

    let applied: Vec<(String, String)> = tx
        .prepare(&format!(
            "select name, hash from {TABLE} where name is not null order by id"
        ))
        .and_then(|mut s| s.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect())
        .map_err(sql)?;
    let mut problems = Vec::new();
    for (name, hash) in &applied {
        match migrations.iter().find(|m| &m.name == name) {
            None => problems.push(format!("{name}: applied, but its migration.sql is gone")),
            Some(m) if &m.hash != hash => {
                problems.push(format!("{name}: edited after it was applied"))
            }
            Some(_) => {}
        }
    }
    if !problems.is_empty() {
        return Err(format!(
            "Applied migrations changed; revert them and add a new migration instead:\n  - {}",
            problems.join("\n  - ")
        ));
    }

    let mut count = 0;
    for m in migrations
        .iter()
        .filter(|m| !applied.iter().any(|(n, _)| n == &m.name))
    {
        for statement in m.sql.split("--> statement-breakpoint") {
            tx.execute_batch(statement)
                .map_err(|e| format!("{}: {e}", m.name))?;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as i64);
        tx.execute(
            &format!(
                "insert into {TABLE} (hash, created_at, name, applied_at) values (?, ?, ?, ?)"
            ),
            (&m.hash, m.folder_millis, &m.name, Timestamp(now).to_iso()),
        )
        .map_err(sql)?;
        count += 1;
    }
    // Only applied migrations are checked, so rows that predate them can't block startup.
    let violation = count > 0
        && tx
            .prepare("PRAGMA foreign_key_check")
            .and_then(|mut statement| Ok(statement.query([])?.next()?.is_some()))
            .map_err(|e| format!("Migration failed foreign_key_check: {e}"))?;
    if violation {
        return Err("Migration failed foreign_key_check".into());
    }
    tx.commit().map_err(sql)?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn repository_migrations() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../drizzle")
    }

    #[test]
    fn reads_folder_timestamps_as_drizzle_does() {
        // Date.UTC(2026, 8, 24, 11, 31, 30)
        assert_eq!(
            folder_millis("20260924113130_initial_schema"),
            Ok(1_790_249_490_000)
        );
        assert!(folder_millis("initial_schema").is_err());
    }

    #[test]
    fn applies_the_repository_migrations_once_and_refuses_edits() {
        let folder = repository_migrations();
        let total = read(&folder).unwrap().len();
        let mut db = Connection::open_in_memory().unwrap();
        assert_eq!(migrate(&mut db, &folder), Ok(total));
        assert_eq!(migrate(&mut db, &folder), Ok(0));
        let entries: i64 = db
            .query_row("select count(*) from time_entry", [], |r| r.get(0))
            .unwrap();
        assert_eq!(entries, 0);

        db.execute(&format!("update {TABLE} set hash = 'old' where id = 1"), [])
            .unwrap();
        let error = migrate(&mut db, &folder).unwrap_err();
        assert!(error.contains("edited after it was applied"), "{error}");
    }

    #[test]
    fn rebuilds_a_parent_without_deleting_children_and_restores_foreign_keys() {
        let folder = std::env::temp_dir().join(format!(
            "snowtime-migrations-rebuild-{}",
            std::process::id()
        ));
        let migration = folder.join("20260101000000_rebuild");
        std::fs::create_dir_all(&migration).unwrap();
        std::fs::write(
            migration.join("migration.sql"),
            "PRAGMA foreign_keys=OFF;
             CREATE TABLE new_parent (id integer PRIMARY KEY);
             INSERT INTO new_parent SELECT * FROM parent;
             DROP TABLE parent;
             ALTER TABLE new_parent RENAME TO parent;
             PRAGMA foreign_keys=ON;",
        )
        .unwrap();
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "PRAGMA foreign_keys=ON;
            CREATE TABLE parent (id integer PRIMARY KEY);
            CREATE TABLE child (parent_id integer REFERENCES parent(id) ON DELETE CASCADE);
            INSERT INTO parent VALUES (1); INSERT INTO child VALUES (1);",
        )
        .unwrap();
        assert_eq!(migrate(&mut db, &folder), Ok(1));
        assert_eq!(
            db.query_row("select count(*) from child", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(db.execute("insert into child values (2)", []).is_err());
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn rolls_back_foreign_key_violations_and_restores_foreign_keys() {
        let folder = std::env::temp_dir().join(format!(
            "snowtime-migrations-foreign-key-{}",
            std::process::id()
        ));
        let migration = folder.join("20260101000000_invalid_child");
        std::fs::create_dir_all(&migration).unwrap();
        std::fs::write(
            migration.join("migration.sql"),
            "INSERT INTO child VALUES (2);",
        )
        .unwrap();
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "PRAGMA foreign_keys=ON;
            CREATE TABLE parent (id integer PRIMARY KEY);
            CREATE TABLE child (parent_id integer REFERENCES parent(id));",
        )
        .unwrap();
        assert!(
            migrate(&mut db, &folder)
                .unwrap_err()
                .contains("foreign_key_check")
        );
        assert_eq!(
            db.query_row("select count(*) from child", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(db.execute("insert into child values (2)", []).is_err());
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn starts_without_pending_migrations_despite_existing_violations() {
        let folder = std::env::temp_dir().join(format!(
            "snowtime-migrations-no-pending-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(folder.join("20260101000000_empty")).unwrap();
        std::fs::write(
            folder.join("20260101000000_empty/migration.sql"),
            "SELECT 1;",
        )
        .unwrap();
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE parent (id integer PRIMARY KEY);
            CREATE TABLE child (parent_id integer REFERENCES parent(id));",
        )
        .unwrap();
        assert_eq!(migrate(&mut db, &folder), Ok(1));
        db.execute_batch(
            "PRAGMA foreign_keys=OFF; INSERT INTO child VALUES (2); PRAGMA foreign_keys=ON;",
        )
        .unwrap();
        assert_eq!(migrate(&mut db, &folder), Ok(0));
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn rolls_back_a_failing_migration() {
        let folder =
            std::env::temp_dir().join(format!("snowtime-migrations-{}", std::process::id()));
        let write = |name: &str, sql: &str| {
            std::fs::create_dir_all(folder.join(name)).unwrap();
            std::fs::write(folder.join(name).join("migration.sql"), sql).unwrap();
        };
        write(
            "20260101000000_good",
            "create table a (x);\n--> statement-breakpoint\ncreate table b (y);",
        );
        write(
            "20260102000000_bad",
            "create table c (z);\n--> statement-breakpoint\nnot sql;",
        );
        let mut db = Connection::open_in_memory().unwrap();
        let error = migrate(&mut db, &folder).unwrap_err();
        std::fs::remove_dir_all(&folder).unwrap();
        assert!(error.starts_with("20260102000000_bad:"), "{error}");
        let tables: i64 = db
            .query_row(
                "select count(*) from sqlite_master where type = 'table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 0, "nothing stays applied");
    }
}
