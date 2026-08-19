use rusqlite::OptionalExtension;

use super::launch_intents::{find_launch_intent_row, insert_launch_intent_row};
use super::sessions::{insert_session_row, map_session};
use super::with_launch_admission_tx;
use super::SessionStore;
use crate::domains::agents::launch_options::{
    HarnessLaunchOptionStateRow, LaunchSelection, LaunchSelectionUnsupported,
};
use crate::domains::sessions::launch_intent::ResolvedLaunchIntent;
use crate::domains::sessions::model::SessionRecord;

#[derive(Debug)]
pub(crate) enum InsertSessionByIdOutcome {
    Inserted,
    Existing {
        record: SessionRecord,
        intent: Option<ResolvedLaunchIntent>,
    },
}

impl SessionStore {
    /// Atomically inserts a caller-selected session id or returns the row that
    /// already owns it. The transaction is the durable idempotency boundary
    /// for retried create requests.
    pub(crate) fn insert_or_find_by_id(
        &self,
        record: &SessionRecord,
        intent: &ResolvedLaunchIntent,
        harness_kind: &str,
        basis_revision: &dyn Fn() -> String,
        selection: &LaunchSelection,
    ) -> Result<(InsertSessionByIdOutcome, HarnessLaunchOptionStateRow), LaunchSelectionUnsupported>
    {
        with_launch_admission_tx(&self.db, harness_kind, basis_revision, selection, |conn| {
            let existing = conn
                .query_row(
                    "SELECT * FROM sessions WHERE id = ?1",
                    [&record.id],
                    map_session,
                )
                .optional()?;
            if let Some(existing) = existing {
                let intent = find_launch_intent_row(conn, &existing.id)?;
                return Ok(InsertSessionByIdOutcome::Existing {
                    record: existing,
                    intent,
                });
            }
            insert_session_row(conn, record)?;
            insert_launch_intent_row(conn, &record.id, intent)?;
            Ok(InsertSessionByIdOutcome::Inserted)
        })
        .map_err(super::LaunchAdmissionTxError::into_selection)
    }
}
