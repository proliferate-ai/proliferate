#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

//! Typed child-reap proof and ordered producer-death qualification.

use std::process::ExitStatus;

use proliferate_diagnostics_client::bridge::wire::WireComponent;

use super::runtime::ChildDiagnosticsBridge;
use crate::diagnostics_collector::supervisor::{TerminalControlOutcome, TerminalProducerSlot};

/// Constructible only from an identity-stable `Child` observation result.
/// Retaining the exit value prevents a bare PID or boolean stop flag from
/// being substituted for reap authority at call sites.
pub(crate) struct VerifiedChildReap {
    _status: ExitStatus,
}

impl VerifiedChildReap {
    pub(crate) fn from_exit_status(status: ExitStatus) -> Self {
        Self { _status: status }
    }
}

impl ChildDiagnosticsBridge {
    /// Drains a buffered terminal frame through bridge EOF, then submits
    /// `producer_dead` only when the cached result contains the exact ordered
    /// fence already validated against this bridge's acknowledged producer.
    pub(crate) async fn finish_verified_reap(
        &self,
        _reap: VerifiedChildReap,
    ) -> TerminalControlOutcome {
        self.finish_reader_after_reap().await;
        let Some(fence) = self
            .qualified_result()
            .and_then(|result| result.delivery_fence)
        else {
            return TerminalControlOutcome::Unavailable;
        };
        let slot = match self.component() {
            WireComponent::Anyharness => TerminalProducerSlot::AnyHarness,
            WireComponent::DesktopWorker => TerminalProducerSlot::DesktopWorker,
        };
        let Some(supervisor) = self.supervisor() else {
            return TerminalControlOutcome::Unavailable;
        };
        supervisor
            .send_producer_dead_if_current(
                slot,
                &fence.collector_boot_id,
                fence.generation,
                &fence.producer_boot_id,
            )
            .await
    }
}
