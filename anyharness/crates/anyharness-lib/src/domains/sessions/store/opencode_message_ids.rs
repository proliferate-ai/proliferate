use rusqlite::{params, OptionalExtension};

use super::SessionStore;

impl SessionStore {
    /// Record the vendor OpenCode message id observed for a runtime
    /// `(turn_id, item_id)` user-message identity. First-writer-wins: a later
    /// call for the same `(session_id, turn_id, item_id)` is a no-op, never an
    /// overwrite (a replayed echo must never clobber the first-observed id).
    pub fn insert_opencode_message_id(
        &self,
        session_id: &str,
        turn_id: &str,
        item_id: &str,
        vendor_message_id: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO opencode_message_ids
                     (session_id, turn_id, item_id, vendor_message_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(session_id, turn_id, item_id) DO NOTHING",
                params![session_id, turn_id, item_id, vendor_message_id, now],
            )?;
            Ok(())
        })
    }

    /// Look up the vendor message id captured for a runtime user-message
    /// identity. `None` means no echo was ever observed for this
    /// `(session_id, turn_id, item_id)` -- callers must treat this as
    /// `TARGET_NOT_FOUND`, never guess or fall back to an ordinal.
    pub fn find_opencode_message_id(
        &self,
        session_id: &str,
        turn_id: &str,
        item_id: &str,
    ) -> anyhow::Result<Option<String>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT vendor_message_id
                   FROM opencode_message_ids
                  WHERE session_id = ?1 AND turn_id = ?2 AND item_id = ?3",
                params![session_id, turn_id, item_id],
                |row| row.get(0),
            )
            .optional()
        })
    }
}
