//! PR1227-WORKSPACE-FENCE-01 proof seam. A keyed, test-only barrier that parks
//! the retire pipeline between the advisory preflight and the exclusive
//! workspace lease, so a deterministic proof can bind a workflow-controlled
//! session in exactly the window the under-lease fence exists to catch. Absent
//! keys cost one mutex lookup and change nothing. Test-only by construction.
//!
//! Lives beside the pipeline it parks: the seam moved out of
//! `api/http/workspaces_lifecycle.rs` with the state machine (grid PR 9),
//! because a domain module may not import `api/**`.

use std::collections::HashMap;
use std::sync::Mutex as StdMutex;

use tokio::sync::oneshot;

#[derive(Default)]
pub(crate) struct RetireBarrier {
    /// Fired when the retire pipeline reaches the pre-exclusive-lease point.
    pub(crate) reached_tx: Option<oneshot::Sender<()>>,
    /// Awaited before acquiring the exclusive lease when present.
    pub(crate) resume_rx: Option<oneshot::Receiver<()>>,
}

static BARRIERS: StdMutex<Option<HashMap<String, RetireBarrier>>> = StdMutex::new(None);

pub(crate) fn install(workspace_id: &str, barrier: RetireBarrier) {
    BARRIERS
        .lock()
        .expect("retire barrier lock")
        .get_or_insert_with(HashMap::new)
        .insert(workspace_id.to_string(), barrier);
}

pub(crate) fn clear(workspace_id: &str) {
    if let Some(map) = BARRIERS.lock().expect("retire barrier lock").as_mut() {
        map.remove(workspace_id);
    }
}

pub(super) async fn at_pre_exclusive(workspace_id: &str) {
    let barrier = BARRIERS
        .lock()
        .expect("retire barrier lock")
        .as_mut()
        .and_then(|map| map.remove(workspace_id));
    let Some(mut barrier) = barrier else {
        return;
    };
    if let Some(tx) = barrier.reached_tx.take() {
        let _ = tx.send(());
    }
    if let Some(rx) = barrier.resume_rx.take() {
        let _ = rx.await;
    }
}
