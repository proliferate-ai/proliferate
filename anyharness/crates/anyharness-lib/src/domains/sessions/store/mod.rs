use crate::domains::agents::launch_options::validation::validate_selection_in_conn;
use crate::domains::agents::launch_options::{
    HarnessLaunchOptionStateRow, LaunchSelection, LaunchSelectionUnsupported,
};
use crate::persistence::Db;

mod adapter_markers;
mod attachments;
mod background_work;
pub(crate) mod completion_deliveries;
mod events;
pub(crate) mod fork_operations;
pub(crate) mod idempotent_create;
pub(crate) mod launch_intents;
pub(crate) mod link_completions;
mod links;
mod live_config;
pub(crate) mod mobility;
mod notifications;
pub(crate) mod opencode_message_ids;
pub(in crate::domains::sessions) mod pending_prompts;
pub(crate) mod persisted_payloads;
pub(crate) mod sessions;
pub(crate) mod support_windows;
mod titles;
mod workflow_links;

#[cfg(test)]
mod tests;

#[derive(Clone)]
pub struct SessionStore {
    db: Db,
}

impl SessionStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    #[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    pub(crate) fn db(&self) -> Db {
        self.db.clone()
    }
}

/// Open the write transaction that owns session admission, reload and exactly
/// validate the current matching-basis options on that connection, then let
/// the caller insert every row in the durable create unit. A refresh cannot
/// commit between validation and the session/intent insert.
pub(crate) fn with_launch_admission_tx<T>(
    db: &Db,
    harness_kind: &str,
    basis_revision: &dyn Fn() -> String,
    selection: &LaunchSelection,
    insert: impl FnOnce(&rusqlite::Connection) -> anyhow::Result<T>,
) -> Result<(T, HarnessLaunchOptionStateRow), LaunchAdmissionTxError> {
    let result = db.with_tx_anyhow(|conn| {
        // Basis computation is owned by the launch-options service but runs
        // while this transaction owns the shared connection. Rechecking after
        // the inserts turns the external install/auth inputs into a CAS: if
        // they changed during admission, the second validation fails and the
        // whole session/intent unit rolls back.
        let opening_basis = basis_revision();
        let validated = validate_selection_in_conn(conn, harness_kind, &opening_basis, selection)
            .map_err(anyhow::Error::new)?;
        let inserted = insert(conn)?;
        let closing_basis = basis_revision();
        validate_selection_in_conn(conn, harness_kind, &closing_basis, selection)
            .map_err(anyhow::Error::new)?;
        Ok((inserted, validated))
    });
    match result {
        Ok(result) => Ok(result),
        Err(error) => match error.downcast::<LaunchSelectionUnsupported>() {
            Ok(error) => Err(LaunchAdmissionTxError::Selection(error)),
            Err(error) => Err(LaunchAdmissionTxError::Store(error)),
        },
    }
}

#[derive(Debug)]
pub(crate) enum LaunchAdmissionTxError {
    Selection(LaunchSelectionUnsupported),
    Store(anyhow::Error),
}

impl LaunchAdmissionTxError {
    pub(crate) fn into_selection(self) -> LaunchSelectionUnsupported {
        match self {
            Self::Selection(error) => error,
            Self::Store(error) => LaunchSelectionUnsupported::Internal(error),
        }
    }
}
