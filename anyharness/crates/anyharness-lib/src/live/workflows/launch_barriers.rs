//! Test-only synchronization at the exact point a workflow's first prompt has
//! been accepted while its workspace lifecycle guard must still be held.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::oneshot;

#[derive(Default)]
pub(crate) struct LaunchBarrier {
    pub reached_tx: Option<oneshot::Sender<()>>,
    pub resume_rx: Option<oneshot::Receiver<()>>,
}

static BARRIERS: Mutex<Option<HashMap<String, LaunchBarrier>>> = Mutex::new(None);

pub(crate) fn install(run_id: &str, barrier: LaunchBarrier) {
    BARRIERS
        .lock()
        .expect("launch barrier lock")
        .get_or_insert_with(HashMap::new)
        .insert(run_id.to_string(), barrier);
}

pub(super) async fn after_prompt_acceptance(run_id: &str) {
    let barrier = BARRIERS
        .lock()
        .expect("launch barrier lock")
        .as_mut()
        .and_then(|barriers| barriers.remove(run_id));
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
