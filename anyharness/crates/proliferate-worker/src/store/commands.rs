use rusqlite::{params, OptionalExtension};

use crate::error::Result;

use super::{now_rfc3339, Store};

#[derive(Debug, Clone)]
pub struct CommandLeaseRecord {
    pub command_id: String,
    pub lease_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub leased_at: Option<String>,
    pub lease_expires_at: Option<String>,
    pub last_error: Option<String>,
}

impl Store {
    pub fn upsert_command_lease(&self, record: &CommandLeaseRecord) -> Result<()> {
        let now = now_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO command_leases (
                    command_id, lease_id, kind, status, leased_at, lease_expires_at,
                    last_error, updated_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(command_id) DO UPDATE SET
                    lease_id = excluded.lease_id,
                    kind = excluded.kind,
                    status = excluded.status,
                    leased_at = excluded.leased_at,
                    lease_expires_at = excluded.lease_expires_at,
                    last_error = excluded.last_error,
                    updated_at = excluded.updated_at",
                params![
                    record.command_id,
                    record.lease_id,
                    record.kind,
                    record.status,
                    record.leased_at,
                    record.lease_expires_at,
                    record.last_error,
                    now,
                ],
            )?;
            Ok(())
        })
    }

    pub fn mark_command_status(
        &self,
        command_id: &str,
        status: &str,
        last_error: Option<&str>,
    ) -> Result<()> {
        let now = now_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE command_leases
                 SET status = ?2, last_error = ?3, updated_at = ?4
                 WHERE command_id = ?1",
                params![command_id, status, last_error, now],
            )?;
            Ok(())
        })
    }

    pub fn load_command_lease(&self, command_id: &str) -> Result<Option<CommandLeaseRecord>> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT command_id, lease_id, kind, status, leased_at, lease_expires_at, last_error
                 FROM command_leases WHERE command_id = ?1",
                params![command_id],
                |row| {
                    Ok(CommandLeaseRecord {
                        command_id: row.get(0)?,
                        lease_id: row.get(1)?,
                        kind: row.get(2)?,
                        status: row.get(3)?,
                        leased_at: row.get(4)?,
                        lease_expires_at: row.get(5)?,
                        last_error: row.get(6)?,
                    })
                },
            )
            .optional()
        })
    }
}
