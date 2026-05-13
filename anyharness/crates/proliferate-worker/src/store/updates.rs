use rusqlite::{params, OptionalExtension};

use crate::error::Result;

use super::{now_rfc3339, Store};

#[derive(Debug, Clone)]
pub struct UpdateStateRecord {
    pub component: String,
    pub installed_version: Option<String>,
    pub desired_version: Option<String>,
    pub staged_path: Option<String>,
    pub status: String,
}

impl Store {
    pub fn upsert_update_state(&self, record: &UpdateStateRecord) -> Result<()> {
        let now = now_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO update_state (
                    component, installed_version, desired_version, staged_path, status, updated_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(component) DO UPDATE SET
                    installed_version = excluded.installed_version,
                    desired_version = excluded.desired_version,
                    staged_path = excluded.staged_path,
                    status = excluded.status,
                    updated_at = excluded.updated_at",
                params![
                    record.component,
                    record.installed_version,
                    record.desired_version,
                    record.staged_path,
                    record.status,
                    now,
                ],
            )?;
            Ok(())
        })
    }

    pub fn load_update_state(&self, component: &str) -> Result<Option<UpdateStateRecord>> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT component, installed_version, desired_version, staged_path, status
                 FROM update_state WHERE component = ?1",
                params![component],
                |row| {
                    Ok(UpdateStateRecord {
                        component: row.get(0)?,
                        installed_version: row.get(1)?,
                        desired_version: row.get(2)?,
                        staged_path: row.get(3)?,
                        status: row.get(4)?,
                    })
                },
            )
            .optional()
        })
    }
}
