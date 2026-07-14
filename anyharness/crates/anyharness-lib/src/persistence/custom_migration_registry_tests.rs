use rusqlite::Connection;

use super::custom_migrations::{CUSTOM_FOREIGN_KEY_MIGRATIONS, CUSTOM_MIGRATIONS};

pub(super) fn mark_foreign_key_migrations_applied(conn: &Connection) {
    for (name, _) in CUSTOM_FOREIGN_KEY_MIGRATIONS {
        conn.execute("INSERT INTO _migrations (name) VALUES (?1)", [name])
            .expect("mark foreign-key migration applied");
    }
}

pub(super) fn table_column_names(conn: &Connection, table_name: &str) -> Vec<String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut stmt = conn.prepare(&pragma).expect("prepare pragma");
    stmt.query_map([], |row| row.get::<_, String>(1))
        .expect("query columns")
        .collect::<Result<_, _>>()
        .expect("collect columns")
}

#[test]
fn custom_migrations_register_review_auto_iterate_rename() {
    assert!(CUSTOM_MIGRATIONS
        .iter()
        .any(|(name, _)| *name == "0036_rename_review_auto_iterate"));
}
