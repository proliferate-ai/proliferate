use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;
use tokio::sync::Mutex;

use crate::commands::cloud_worker::{self, SharedCloudWorkerState};
use crate::sidecar::{self, SharedSidecar};

use super::broker::server::DiagnosticsBrokerServer;
use super::fallback::FallbackDiagnosticsWriter;
use super::producer::{TauriDiagnosticsProducer, PRODUCER_DRAIN_TIMEOUT};
use super::supervisor::DiagnosticsCollectorSupervisor;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShutdownPhase {
    Arm,
    CancelBrokerSessions,
    DrainProducer,
    StopWorker,
    StopAnyharness,
    StopCollector,
    CloseArtifacts,
}

const SHUTDOWN_PHASE_ORDER: [ShutdownPhase; 7] = [
    ShutdownPhase::Arm,
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
    result: Mutex<Option<Result<(), String>>>,
    supervisor: Arc<DiagnosticsCollectorSupervisor>,
    producer: TauriDiagnosticsProducer,
    fallback: FallbackDiagnosticsWriter,
    broker: SharedBrokerServerState,
    worker: SharedCloudWorkerState,
    anyharness: SharedSidecar,
    #[cfg(test)]
    phase_trace: std::sync::Mutex<Vec<ShutdownPhase>>,
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
    ) -> Arc<Self> {
        Arc::new(Self {
            armed: AtomicBool::new(false),
            result: Mutex::new(None),
            supervisor,
            producer,
            fallback,
            broker,
            worker,
            anyharness,
            #[cfg(test)]
            phase_trace: std::sync::Mutex::new(Vec::new()),
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

    pub(crate) async fn shutdown(&self) -> Result<(), String> {
        // Serialize the entire once-only teardown. A concurrent updater/Exit
        // caller must observe the completed result, never a premature success.
        let mut completed = self.result.lock().await;
        if let Some(result) = completed.as_ref() {
            return result.clone();
        }
        self.armed.store(true, Ordering::Release);
        let mut failed = false;
        let mut order = ShutdownOrder::default();

        self.enter_phase(&mut order, ShutdownPhase::Arm);
        self.supervisor.arm_shutdown();
        cloud_worker::lifecycle::arm_terminal_shutdown(&self.worker);
        sidecar::arm_terminal_shutdown(&self.anyharness).await;
        self.enter_phase(&mut order, ShutdownPhase::CancelBrokerSessions);
        let broker = self.broker.lock().await.clone();
        if let Some(broker) = &broker {
            broker.stop_accepting();
            if let Err(error) = broker.wait_stopped().await {
                tracing::warn!(?error, "diagnostics broker sessions did not stop cleanly");
                failed = true;
            }
        }

        self.enter_phase(&mut order, ShutdownPhase::DrainProducer);
        let _ = self.producer.drain(PRODUCER_DRAIN_TIMEOUT).await;

        self.enter_phase(&mut order, ShutdownPhase::StopWorker);
        let worker_stop = self.producer.begin_lifecycle("desktop.worker_process.stop");
        match cloud_worker::lifecycle::arm_terminal_shutdown_and_stop_worker(&self.worker).await {
            Ok(true) => worker_stop.terminal(TerminalOutcomeV1::Succeeded, None),
            Ok(false) => worker_stop.terminal(TerminalOutcomeV1::Skipped, None),
            Err(error) => {
                failed = true;
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
            failed = true;
            tracing::warn!(%error, "failed to stop AnyHarness during app exit");
        }

        self.enter_phase(&mut order, ShutdownPhase::StopCollector);
        if let Err(error) = self.supervisor.stop_collector().await {
            failed = true;
            tracing::warn!(
                ?error,
                "failed to stop diagnostics collector during app exit"
            );
        }

        self.enter_phase(&mut order, ShutdownPhase::CloseArtifacts);
        self.producer.close();
        if let Some(broker) = broker {
            if let Err(error) = broker.remove_locator_and_unlock() {
                failed = true;
                tracing::warn!(?error, "failed to remove diagnostics broker locator");
            }
        }
        if let Err(error) = self.fallback.close() {
            failed = true;
            tracing::warn!(%error, "failed to close diagnostics fallback");
        }
        debug_assert!(order.is_complete());
        let result = if failed {
            Err("diagnostics_shutdown_failed".to_string())
        } else {
            Ok(())
        };
        *completed = Some(result.clone());
        result
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
