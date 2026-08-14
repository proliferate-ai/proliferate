//! Workflow composition root: the boot fence. Gen-1's fence made policy — no
//! auto-resume ever. The sweep runs during app construction, BEFORE the
//! manager exists, so no actor can accept a command against un-fenced rows:
//! every run whose rows claim live execution parks interrupted with its
//! current node needs_attention, and resume is always a human choice.
//! `awaiting_human` and `interrupted` runs are durable parks and survive
//! untouched.

use crate::domains::workflows::model::WorkflowInterruptionCode;
use crate::domains::workflows::store::WorkflowStore;
use crate::domains::workflows::transition::{next, Decision, WorkflowEvent};

/// Fence every run recorded as running. Returns the fenced run ids (the
/// resume popover's feed). Per-run failures are logged and skipped: one
/// corrupt run must not block the app boot, and its rows stay non-terminal
/// for the next fence.
pub fn run_boot_fence(store: &WorkflowStore) -> Vec<String> {
    let run_ids = match store.running_run_ids() {
        Ok(run_ids) => run_ids,
        Err(error) => {
            tracing::error!(error = %error, "workflow boot fence sweep query failed");
            return Vec::new();
        }
    };
    let mut fenced = Vec::new();
    for run_id in run_ids {
        let state = match store.load_run_state(&run_id) {
            Ok(Some(state)) => state,
            Ok(None) => continue,
            Err(error) => {
                tracing::error!(run_id = %run_id, error = %error, "workflow boot fence load failed");
                continue;
            }
        };
        let event = WorkflowEvent::BootFence {
            code: WorkflowInterruptionCode::RuntimeRestarted,
        };
        let transition = match next(&state, &event) {
            Decision::Transition(transition) => transition,
            // Hold: already terminal or already fenced — idempotent.
            Decision::Hold | Decision::Illegal(_) => continue,
        };
        match store.apply_transition(&run_id, &transition) {
            Ok(_applied) => fenced.push(run_id),
            Err(error) => {
                tracing::error!(run_id = %run_id, error = %error, "workflow boot fence persist failed");
            }
        }
    }
    WorkflowStore::emit_boot_fence_summary(&fenced);
    fenced
}
