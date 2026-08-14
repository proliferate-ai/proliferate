use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;
use tokio::sync::Mutex;
use tokio::time::Instant;

use crate::commands::cloud_worker::{self, SharedCloudWorkerState};
use crate::diagnostics::support_snapshot::coordinator::SupportSnapshotCoordinator;
use crate::sidecar::{self, SharedSidecar};

use super::broker::server::DiagnosticsBrokerServer;
use super::fallback::FallbackDiagnosticsWriter;
use super::producer::{TauriDiagnosticsProducer, PRODUCER_DRAIN_TIMEOUT};
use super::supervisor::DiagnosticsCollectorSupervisor;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShutdownPhase {
    Arm,
    CancelSupport,
    CancelBrokerSessions,
    DrainProducer,
    StopWorker,
    StopAnyharness,
    StopCollector,
    CloseArtifacts,
}

const SHUTDOWN_PHASE_ORDER: [ShutdownPhase; 8] = [
    ShutdownPhase::Arm,
    ShutdownPhase::CancelSupport,
    ShutdownPhase::CancelBrokerSessions,
    ShutdownPhase::DrainProducer,
    ShutdownPhase::StopWorker,
    ShutdownPhase::StopAnyharness,
    ShutdownPhase::StopCollector,
    ShutdownPhase::CloseArtifacts,
];

#[derive(Default)]
struct ShutdownOrder {
    next: usize,
}

impl ShutdownOrder {
    fn enter(&mut self, phase: ShutdownPhase) {
        assert_eq!(SHUTDOWN_PHASE_ORDER.get(self.next), Some(&phase));
        self.next += 1;
    }

    fn is_complete(&self) -> bool {
        self.next == SHUTDOWN_PHASE_ORDER.len()
    }
}

pub(crate) type SharedBrokerServerState = Arc<Mutex<Option<Arc<DiagnosticsBrokerServer>>>>;

pub(crate) fn create_broker_server_state() -> SharedBrokerServerState {
    Arc::new(Mutex::new(None))
}

pub(crate) struct DiagnosticsShutdownCoordinator {
    armed: AtomicBool,
    /// Set once the product teardown has actually succeeded. A failed attempt
    /// is deliberately never recorded: the Windows updater and `RunEvent::Exit`
    /// both retry through this coordinator and must re-run the phases rather
    /// than replay a cached error that stopped nothing.
    torn_down: Mutex<bool>,
    supervisor: Arc<DiagnosticsCollectorSupervisor>,
    producer: TauriDiagnosticsProducer,
    fallback: FallbackDiagnosticsWriter,
    broker: SharedBrokerServerState,
    worker: SharedCloudWorkerState,
    anyharness: SharedSidecar,
    support: Arc<SupportSnapshotCoordinator>,
    #[cfg(test)]
    phase_trace: std::sync::Mutex<Vec<ShutdownPhase>>,
    #[cfg(test)]
    diagnostics_teardown_failed: AtomicBool,
}

impl std::fmt::Debug for DiagnosticsShutdownCoordinator {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DiagnosticsShutdownCoordinator")
            .field("armed", &self.armed.load(Ordering::Acquire))
            .finish_non_exhaustive()
    }
}

impl DiagnosticsShutdownCoordinator {
    pub(crate) fn new(
        supervisor: Arc<DiagnosticsCollectorSupervisor>,
        producer: TauriDiagnosticsProducer,
        fallback: FallbackDiagnosticsWriter,
        broker: SharedBrokerServerState,
        worker: SharedCloudWorkerState,
        anyharness: SharedSidecar,
        support: Arc<SupportSnapshotCoordinator>,
    ) -> Arc<Self> {
        Arc::new(Self {
            armed: AtomicBool::new(false),
            torn_down: Mutex::new(false),
            supervisor,
            producer,
            fallback,
            broker,
            worker,
            anyharness,
            support,
            #[cfg(test)]
            phase_trace: std::sync::Mutex::new(Vec::new()),
            #[cfg(test)]
            diagnostics_teardown_failed: AtomicBool::new(false),
        })
    }

    fn enter_phase(&self, order: &mut ShutdownOrder, phase: ShutdownPhase) {
        order.enter(phase);
        #[cfg(test)]
        if let Ok(mut trace) = self.phase_trace.lock() {
            trace.push(phase);
        }
    }

    #[cfg(test)]
    fn phase_trace(&self) -> Vec<ShutdownPhase> {
        self.phase_trace
            .lock()
            .map(|trace| trace.clone())
            .unwrap_or_default()
    }

    #[cfg(test)]
    fn diagnostics_teardown_failed(&self) -> bool {
        self.diagnostics_teardown_failed.load(Ordering::Acquire)
    }

    /// Runs the ordered teardown and reports only the *product* teardown result.
    ///
    /// The diagnostics phases (broker sessions, collector child, locator, and
    /// fallback) are torn down here too, but their failures are logged and
    /// dropped: observability never changes a product operation's result, so a
    /// broker drain or fallback flush error must not block the Windows
    /// updater's `install()`. Only the Worker and AnyHarness stops decide what a
    /// caller sees; those are the processes an installer or the next launch
    /// would collide with.
    pub(crate) async fn shutdown(&self) -> Result<(), String> {
        // Serialize the entire once-only teardown. A concurrent updater/Exit
        // caller must observe the completed result, never a premature success.
        // A failed attempt is not memoized, so the next caller re-attempts the
        // teardown instead of replaying an error that stopped nothing.
        let mut torn_down = self.torn_down.lock().await;
        if *torn_down {
            return Ok(());
        }
        self.armed.store(true, Ordering::Release);
        let mut product_failed = false;
        let mut diagnostics_failed = false;
        let mut order = ShutdownOrder::default();

        self.enter_phase(&mut order, ShutdownPhase::Arm);
        self.supervisor.arm_shutdown();
        cloud_worker::lifecycle::arm_terminal_shutdown(&self.worker);
        sidecar::arm_terminal_shutdown(&self.anyharness);
        self.enter_phase(&mut order, ShutdownPhase::CancelSupport);
        self.support.cancel_support().await;
        self.enter_phase(&mut order, ShutdownPhase::CancelBrokerSessions);
        let broker = self.broker.lock().await.clone();
        if let Some(broker) = &broker {
            broker.stop_accepting();
            if let Err(error) = broker.wait_stopped().await {
                tracing::warn!(?error, "diagnostics broker sessions did not stop cleanly");
                diagnostics_failed = true;
            }
        }

        self.enter_phase(&mut order, ShutdownPhase::DrainProducer);
        // One absolute deadline governs all three drains: the Tauri producer
        // drain plus both child bridge flush requests. Each child flush is
        // capped at the milliseconds remaining on this same deadline; a
        // missing response never extends it.
        let flush_deadline = Instant::now() + PRODUCER_DRAIN_TIMEOUT;
        let _ = tokio::join!(
            self.producer.drain_until(flush_deadline),
            cloud_worker::lifecycle::flush_child_diagnostics(&self.worker, flush_deadline),
            sidecar::observer::flush_child_diagnostics(&self.anyharness, flush_deadline),
        );

        self.enter_phase(&mut order, ShutdownPhase::StopWorker);
        let worker_stop = self.producer.begin_lifecycle("desktop.worker_process.stop");
        match cloud_worker::lifecycle::arm_terminal_shutdown_and_stop_worker(&self.worker).await {
            Ok(true) => worker_stop.terminal(TerminalOutcomeV1::Succeeded, None),
            Ok(false) => worker_stop.terminal(TerminalOutcomeV1::Skipped, None),
            Err(error) => {
                product_failed = true;
                tracing::warn!(%error, "failed to stop Proliferate Worker during app exit");
                if error.starts_with("Timed out") {
                    worker_stop.terminal(TerminalOutcomeV1::TimedOut, Some("shutdown_timeout"));
                } else if error.starts_with("Failed to inspect") {
                    worker_stop
                        .terminal(TerminalOutcomeV1::Failed, Some("child_inspection_failed"));
                } else {
                    worker_stop.terminal(TerminalOutcomeV1::Failed, Some("shutdown_failed"));
                }
            }
        }

        self.enter_phase(&mut order, ShutdownPhase::StopAnyharness);
        if let Err(error) = sidecar::stop(&self.anyharness, &self.producer).await {
            product_failed = true;
            tracing::warn!(%error, "failed to stop AnyHarness during app exit");
        }

        self.enter_phase(&mut order, ShutdownPhase::StopCollector);
        if let Err(error) = self.supervisor.stop_collector().await {
            diagnostics_failed = true;
            tracing::warn!(
                ?error,
                "failed to stop diagnostics collector during app exit"
            );
        }

        self.enter_phase(&mut order, ShutdownPhase::CloseArtifacts);
        self.producer.close();
        if let Some(broker) = broker {
            if let Err(error) = broker.remove_locator_and_unlock() {
                diagnostics_failed = true;
                tracing::warn!(?error, "failed to remove diagnostics broker locator");
            }
        }
        if let Err(error) = self.fallback.close() {
            diagnostics_failed = true;
            tracing::warn!(%error, "failed to close diagnostics fallback");
        }
        debug_assert!(order.is_complete());
        if diagnostics_failed {
            // Recorded for the teardown log only. Returning it would let an
            // observability fault block the updater or an orderly exit.
            tracing::warn!("diagnostics teardown reported failures during app exit");
            #[cfg(test)]
            self.diagnostics_teardown_failed
                .store(true, Ordering::Release);
        }
        if product_failed {
            // Left un-memoized on purpose: the updater retry and `RunEvent::Exit`
            // must re-enter the phases so the Worker and AnyHarness children get
            // another stop attempt.
            return Err("desktop_shutdown_failed".to_string());
        }
        *torn_down = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_phase_machine_pins_the_frozen_order() {
        let mut order = ShutdownOrder::default();
        for phase in SHUTDOWN_PHASE_ORDER {
            order.enter(phase);
        }
        assert!(order.is_complete());
    }

    #[test]
    #[should_panic]
    fn shutdown_phase_machine_rejects_reordering() {
        let mut order = ShutdownOrder::default();
        order.enter(ShutdownPhase::StopCollector);
    }
}

#[cfg(test)]
#[path = "shutdown_tests.rs"]
mod integration_tests;
