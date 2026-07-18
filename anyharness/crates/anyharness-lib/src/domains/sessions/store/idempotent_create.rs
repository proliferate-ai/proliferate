use rusqlite::OptionalExtension;

use super::sessions::{insert_session_row, map_session};
use super::SessionStore;
use crate::domains::sessions::model::SessionRecord;

#[derive(Debug)]
pub(crate) enum InsertSessionByIdOutcome {
    Inserted,
    Existing(SessionRecord),
}

impl SessionStore {
    /// Atomically inserts a caller-selected session id or returns the row that
    /// already owns it. The transaction is the durable idempotency boundary
    /// for retried create requests.
    pub(crate) fn insert_or_find_by_id(
        &self,
        record: &SessionRecord,
    ) -> anyhow::Result<InsertSessionByIdOutcome> {
        self.db.with_tx(|conn| {
            let existing = conn
                .query_row(
                    "SELECT * FROM sessions WHERE id = ?1",
                    [&record.id],
                    map_session,
                )
                .optional()?;
            if let Some(existing) = existing {
                return Ok(InsertSessionByIdOutcome::Existing(existing));
            }
            insert_session_row(conn, record)?;
            Ok(InsertSessionByIdOutcome::Inserted)
        })
    }
}
