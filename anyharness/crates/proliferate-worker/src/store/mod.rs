use std::path::PathBuf;

use serde_json::Value;

mod applied_revisions;
mod catalog_push_state;
mod connection;
mod exposure_cache;
mod identity;
mod migrations;
mod pending_command_results;
mod tail_mappings;
mod up_cursor;

pub use applied_revisions::{AppliedRevisionState, ReconcileDomain, RevisionFailure};
pub use exposure_cache::WorkerExposureSnapshot;
pub use up_cursor::{TailCursor, TailCursorUpsert};

pub struct WorkerStore {
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct PendingCommandResult {
    pub command_id: String,
    pub lease_id: String,
    pub cloud_workspace_id: Option<String>,
    pub anyharness_workspace_id: Option<String>,
    pub status: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub result: Option<Value>,
}

impl Clone for WorkerStore {
    fn clone(&self) -> Self {
        Self {
            path: self.path.clone(),
        }
    }
}
