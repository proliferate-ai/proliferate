use chrono::Utc;
use rusqlite::{params, Connection};

use crate::error::Result;

pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch(super::schema::INIT_SQL)?;
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
        params![1_i64, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}
