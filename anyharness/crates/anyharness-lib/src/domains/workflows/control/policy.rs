//! The Workflows-owned controller policy for session mutation admission
//! (spec 2b): active `workflow_runs.session_id` is the ONLY durable
//! controller record. Sessions owns the gate mechanics and the trait;
//! `app/` injects this implementation so session core never imports the
//! Workflows domain.

use crate::domains::sessions::admission::SessionControllerPolicy;
use crate::domains::workflows::store::WorkflowRunStore;

pub struct WorkflowSessionControllerPolicy {
    store: WorkflowRunStore,
}

impl WorkflowSessionControllerPolicy {
    pub fn new(store: WorkflowRunStore) -> Self {
        Self { store }
    }
}

impl SessionControllerPolicy for WorkflowSessionControllerPolicy {
    fn controlling_run_id(&self, session_id: &str) -> anyhow::Result<Option<String>> {
        self.store.find_active_controller_run(session_id)
    }
}
