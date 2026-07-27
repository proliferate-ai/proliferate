//! The read half of `ModelSnapshotService`: the document and the polled status
//! surface.
//!
//! A second `impl` block in its own file, because reads are available in READ-ONLY
//! mode too — serving is not probing — and keeping them beside the reconciler
//! invited the assumption that they share its ownership gate. They do not.

use chrono::{DateTime, Utc};

use super::document::{self, read_document, ModelSnapshotDocument};
use super::{status, ModelSnapshotService};

impl ModelSnapshotService {
    // -----------------------------------------------------------------------
    // Reads. Available in read-only mode too — serving is not probing.
    // -----------------------------------------------------------------------

    pub fn document(&self, harness_kind: &str) -> Option<ModelSnapshotDocument> {
        read_document(&self.runtime_home, harness_kind)
    }

    /// The polled status surface for one harness (model-catalog.md, "Runtime
    /// routes"). `state` and the engine mode are live in-memory facts; everything
    /// else is read off the document, so a restart shows correct history with
    /// `state: "idle"`.
    pub fn status(&self, harness_kind: &str, now: DateTime<Utc>) -> status::ModelSnapshotStatus {
        let (live_state, next_attempt_at) = self.live_state(harness_kind, now);
        status::project_status(status::StatusInputs {
            agent: harness_kind.to_string(),
            schema_version: document::MODEL_SNAPSHOT_SCHEMA_VERSION,
            probe_engine: self.mode(),
            document: self.document(harness_kind),
            now,
            live_state,
            next_attempt_at,
        })
    }

    /// A slot the engine has never touched reports idle, which is honest: nothing
    /// is running and nothing is scheduled.
    ///
    /// An in-flight state (`Queued` or `Running`) outranks a backoff window: the
    /// engine really is working on this harness right now, and reporting "retry
    /// pending" while a probe is mid-flight would make a polling UI hide its own
    /// spinner.
    fn live_state(
        &self,
        harness_kind: &str,
        now: DateTime<Utc>,
    ) -> (status::LiveState, Option<DateTime<Utc>>) {
        let slots = self.slots.lock().expect("model snapshot slots poisoned");
        let Some(slot) = slots.get(harness_kind) else {
            return (status::LiveState::Idle, None);
        };
        let state = slot.state.lock().expect("model snapshot slot poisoned");
        if matches!(
            state.live,
            status::LiveState::Queued | status::LiveState::Running
        ) {
            return (state.live, None);
        }
        match state.next_attempt_at {
            Some(next) if next > now => (status::LiveState::Backoff, Some(next)),
            _ => (status::LiveState::Idle, None),
        }
    }
}
