//! Collector-generation availability transitions and their loud logging. The
//! 2026-08-15 outage counted loss for 10.5h without one line in the runtime's
//! own log; every latch into `Unavailable` now says so out loud, and every
//! re-attach answers it.

use super::AdmissionState;
#[cfg(unix)]
use super::{CollectorAvailability, ProducerInner};
#[cfg(unix)]
use crate::fallback::FallbackReason;
#[cfg(unix)]
use std::sync::Arc;

#[cfg(unix)]
impl ProducerInner {
    pub(crate) fn replace_generation(
        &self,
        generation: crate::bridge::activation::CollectorGenerationHandle,
    ) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let current = match &state.collector {
            CollectorAvailability::Ready(current)
            | CollectorAvailability::Cooldown {
                generation: current,
                ..
            } => current.generation,
            CollectorAvailability::Unavailable { generation } => *generation,
        };
        if generation.generation <= current {
            return;
        }
        for record in &mut state.queue {
            record.fallback_reason = Some(FallbackReason::GenerationChanged);
        }
        if !state.in_flight.is_empty() {
            state.delivery_fence_eligible = false;
        }
        let generation_number = generation.generation;
        state.collector = CollectorAvailability::Ready(Arc::new(generation));
        drop(state);
        info_delivery_reattached(generation_number);
        self.notify.notify_one();
    }

    pub(crate) fn mark_generation_unavailable(&self, generation: u64) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let current = match &state.collector {
            CollectorAvailability::Ready(current)
            | CollectorAvailability::Cooldown {
                generation: current,
                ..
            } => current.generation,
            CollectorAvailability::Unavailable { generation } => *generation,
        };
        if generation <= current {
            return;
        }
        for record in &mut state.queue {
            record.fallback_reason = Some(FallbackReason::GenerationChanged);
        }
        state.collector = CollectorAvailability::Unavailable { generation };
        if !state.in_flight.is_empty() {
            state.delivery_fence_eligible = false;
        }
        let warn = state.note_delivery_ended(generation);
        drop(state);
        if warn {
            warn_delivery_ended(generation);
        }
        self.notify.notify_one();
    }
}

impl AdmissionState {
    /// One-shot per generation: several sites can observe the same dead
    /// generation (a bridge notice, a boot-mismatched receipt, retries), but
    /// the loud delivery-end warning fires once.
    pub(crate) fn note_delivery_ended(&mut self, generation: u64) -> bool {
        if self.delivery_end_warned_generation == Some(generation) {
            return false;
        }
        self.delivery_end_warned_generation = Some(generation);
        true
    }
}

/// WARN is re-ingested by the tracing layer, which is acceptable: the caller
/// guards with `note_delivery_ended` and the pipe being described is already
/// dead. Callers emit outside the admission-state lock.
pub(crate) fn warn_delivery_ended(generation: u64) {
    tracing::warn!(
        target: "anyharness.diagnostics.delivery",
        generation,
        "diagnostics delivery ended: collector generation gone; records count as loss until re-attach"
    );
}

/// The canonical re-attach line answering `warn_delivery_ended`; call sites
/// must not log their own copy.
#[cfg(unix)]
pub(crate) fn info_delivery_reattached(generation: u64) {
    tracing::info!(
        target: "anyharness.diagnostics.delivery",
        generation,
        "diagnostics delivery re-attached: collector generation ready"
    );
}
