//! Shared schema inspection for custom SQLite migrations.

use rusqlite::Transaction;

pub(super) fn table_columns(
    tx: &Transaction<'_>,
    table_name: &str,
) -> rusqlite::Result<Vec<String>> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut stmt = tx.prepare(&pragma)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    rows.collect()
}
