//! Test-only synchronization immediately before existing-workspace adoption
//! takes its shared lifecycle guard.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::oneshot;

#[derive(Default)]
pub(crate) struct ExistingWorkspaceLeaseBarrier {
    pub reached_tx: Option<oneshot::Sender<()>>,
    pub resume_rx: Option<oneshot::Receiver<()>>,
}

static BARRIERS: Mutex<Option<HashMap<String, ExistingWorkspaceLeaseBarrier>>> = Mutex::new(None);

pub(crate) fn install(workspace_id: &str, barrier: ExistingWorkspaceLeaseBarrier) {
    BARRIERS
        .lock()
        .expect("existing-workspace lease barrier lock")
        .get_or_insert_with(HashMap::new)
        .insert(workspace_id.to_string(), barrier);
}

pub(super) async fn before_acquire(workspace_id: &str) {
    let barrier = BARRIERS
        .lock()
        .expect("existing-workspace lease barrier lock")
        .as_mut()
        .and_then(|barriers| barriers.remove(workspace_id));
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
