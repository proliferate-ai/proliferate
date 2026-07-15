//! Transient per-run async serialization (spec workflow-run-control §6.1).
//!
//! This is the rename plus deliberate scope EXTENSION of the former
//! PUT-acceptance-only keyed gate: acceptance, execution CAS boundaries, the
//! completion extension's terminal CAS, and cancellation all serialize on the
//! same per-run key. `app/` constructs one shared `Arc<WorkflowRunGates>` and
//! injects it into the workflow runtime and the completion extension. The
//! slots are transient (weak) — a key with no holder costs nothing durable.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, Weak};

use tokio::sync::Mutex as AsyncMutex;

#[derive(Default)]
pub struct WorkflowRunGates {
    slots: StdMutex<HashMap<String, Weak<AsyncMutex<()>>>>,
}

impl WorkflowRunGates {
    pub fn new() -> Self {
        Self::default()
    }

    /// The per-run gate for `run_id`. Callers hold the returned mutex across
    /// exactly the acquisition windows in spec §6.2; the slot map is pruned of
    /// dead entries on every lookup.
    pub fn slot(&self, run_id: &str) -> anyhow::Result<Arc<AsyncMutex<()>>> {
        let mut slots = self
            .slots
            .lock()
            .map_err(|_| anyhow::anyhow!("workflow run gate lock poisoned"))?;
        slots.retain(|_, gate| gate.strong_count() > 0);
        if let Some(gate) = slots.get(run_id).and_then(Weak::upgrade) {
            return Ok(gate);
        }
        let gate = Arc::new(AsyncMutex::new(()));
        slots.insert(run_id.to_string(), Arc::downgrade(&gate));
        Ok(gate)
    }
}
