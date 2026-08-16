use rusqlite::{params, OptionalExtension};

use super::SessionStore;
use crate::domains::sessions::adapter_migration::SessionAdapterMarker;

impl SessionStore {
    /// Stamp (or restamp) the adapter-migration marker for a session: the
    /// `(adapter_version, native_version)` pair it was created or attached
    /// under. Versions only — never credential facts (Forks ADR R9). Idempotent
    /// per session id.
    pub fn upsert_adapter_marker(
        &self,
        session_id: &str,
        marker: &SessionAdapterMarker,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_adapter_markers
                     (session_id, adapter_version, native_version, created_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(session_id) DO UPDATE SET
                     adapter_version = excluded.adapter_version,
                     native_version = excluded.native_version,
                     created_at = excluded.created_at",
                params![
                    session_id,
                    marker.adapter_version,
                    marker.native_version,
                    now,
                ],
            )?;
            Ok(())
        })
    }

    /// The recorded marker for a session, or `None` when the session predates
    /// the marker (treated by the dual-read seam as the pinned pre-migration
    /// floor).
    pub fn find_adapter_marker(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<SessionAdapterMarker>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT adapter_version, native_version
                   FROM session_adapter_markers
                  WHERE session_id = ?1",
                [session_id],
                |row| {
                    Ok(SessionAdapterMarker {
                        adapter_version: row.get(0)?,
                        native_version: row.get(1)?,
                    })
                },
            )
            .optional()
        })
    }
}
