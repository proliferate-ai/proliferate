use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;
use tokio::sync::{watch, Mutex as AsyncMutex};

use crate::diagnostics_collector::export_admission::ExportAdmission;

use super::{
    classification_for_launch_error, retryable, CollectorLaunchError, CollectorLaunchErrorKind,
    CollectorLaunchKindV1, CollectorProcessLauncher, DesktopDiagnosticsSupervisorStateV1,
    DiagnosticsCollectorSupervisor, FallbackDiagnosticsWriter, StartupBarrierResult,
    SupervisorInner, TauriDiagnosticsProducer, AUTOMATIC_RESTART_DELAYS,
};

impl DiagnosticsCollectorSupervisor {
    pub(crate) fn new(
        producer: TauriDiagnosticsProducer,
        fallback: FallbackDiagnosticsWriter,
        release: String,
        environment: String,
    ) -> Arc<Self> {
        let launcher = CollectorProcessLauncher::discover(release, environment, fallback.clone());
        Self::with_launcher(producer, fallback, launcher)
    }

    pub(crate) fn with_launcher(
        producer: TauriDiagnosticsProducer,
        fallback: FallbackDiagnosticsWriter,
        launcher: Result<CollectorProcessLauncher, CollectorLaunchError>,
    ) -> Arc<Self> {
        let initial = DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false };
        let (state_tx, _) = watch::channel(initial.clone());
        let (startup_tx, _) = watch::channel(StartupBarrierResult::Pending);
        let (generation_tx, _) = watch::channel(0_u64);
        let (shutdown_tx, _) = watch::channel(false);
        Arc::new(Self {
            inner: Mutex::new(SupervisorInner {
                process: None,
                retained_launch: None,
                state: initial,
                generation: 0,
                restart_count: 0,
                restart_attempts: VecDeque::with_capacity(AUTOMATIC_RESTART_DELAYS.len()),
                ready_since: None,
            }),
            decisions: AsyncMutex::new(()),
            launcher,
            producer,
            fallback,
            state_tx,
            startup_tx,
            generation_tx,
            shutdown_tx,
            export_admission: ExportAdmission::shared_capacity_one(),
            shutdown_armed: AtomicBool::new(false),
            terminal_control: Default::default(),
        })
    }

    #[cfg(test)]
    pub(crate) fn with_fake_launch_error(
        producer: TauriDiagnosticsProducer,
        fallback: FallbackDiagnosticsWriter,
        error: CollectorLaunchError,
    ) -> Arc<Self> {
        Self::with_launcher(producer, fallback, Err(error))
    }

    pub(crate) fn state(&self) -> DesktopDiagnosticsSupervisorStateV1 {
        self.inner
            .lock()
            .map(|inner| inner.state.clone())
            .unwrap_or(DesktopDiagnosticsSupervisorStateV1::Degraded {
                classification: "child_inspection_failed".to_string(),
                restart_count: 0,
                retry_exhausted: true,
            })
    }

    pub(crate) fn subscribe_state(&self) -> watch::Receiver<DesktopDiagnosticsSupervisorStateV1> {
        self.state_tx.subscribe()
    }

    pub(crate) fn subscribe_generation(&self) -> watch::Receiver<u64> {
        self.generation_tx.subscribe()
    }

    pub(crate) fn subscribe_shutdown(&self) -> watch::Receiver<bool> {
        self.shutdown_tx.subscribe()
    }

    pub(crate) fn export_admission(&self) -> Arc<ExportAdmission> {
        Arc::clone(&self.export_admission)
    }

    pub(crate) fn shutdown_is_armed(&self) -> bool {
        self.shutdown_armed.load(Ordering::Acquire)
    }

    pub(crate) async fn start(self: &Arc<Self>) -> StartupBarrierResult {
        let _decision = self.decisions.lock().await;
        if self.shutdown_armed.load(Ordering::Acquire) {
            self.resolve_startup(StartupBarrierResult::Degraded);
            return StartupBarrierResult::Degraded;
        }
        if *self.startup_tx.borrow() != StartupBarrierResult::Pending {
            return *self.startup_tx.borrow();
        }

        let start_operation = self.producer.begin_lifecycle("desktop.collector.start");
        let launcher = match &self.launcher {
            Ok(launcher) => launcher,
            Err(error) => {
                let classification = classification_for_launch_error(error.kind);
                let unsupported = error.kind == CollectorLaunchErrorKind::UnsupportedTarget;
                self.publish_state(if unsupported {
                    DesktopDiagnosticsSupervisorStateV1::Unsupported {
                        classification: classification.to_string(),
                    }
                } else {
                    DesktopDiagnosticsSupervisorStateV1::Degraded {
                        classification: classification.to_string(),
                        restart_count: 0,
                        retry_exhausted: false,
                    }
                });
                start_operation.terminal(
                    if unsupported {
                        TerminalOutcomeV1::Skipped
                    } else {
                        TerminalOutcomeV1::Failed
                    },
                    Some(classification),
                );
                self.resolve_startup(StartupBarrierResult::Degraded);
                return StartupBarrierResult::Degraded;
            }
        };

        self.publish_starting(CollectorLaunchKindV1::Initial, 1);
        match launcher.launch().await {
            Ok(process) => {
                if self.shutdown_armed.load(Ordering::Acquire) {
                    if let Ok(mut inner) = self.inner.lock() {
                        inner.process = Some(process);
                    }
                    start_operation.terminal(TerminalOutcomeV1::Cancelled, Some("shutdown_armed"));
                    self.publish_degraded("shutdown_armed", false);
                    self.resolve_startup(StartupBarrierResult::Degraded);
                    return StartupBarrierResult::Degraded;
                }
                self.accept_ready(process);
                start_operation.terminal(TerminalOutcomeV1::Succeeded, None);
                self.resolve_startup(StartupBarrierResult::Ready);
                self.spawn_monitor();
                StartupBarrierResult::Ready
            }
            Err(mut error) => {
                self.retain_failed_launch(&mut error);
                let classification = classification_for_launch_error(error.kind);
                let outcome = if error.kind == CollectorLaunchErrorKind::ReadinessTimeout {
                    TerminalOutcomeV1::TimedOut
                } else {
                    TerminalOutcomeV1::Failed
                };
                start_operation.terminal(outcome, Some(classification));
                self.publish_degraded(classification, false);
                if retryable(error.kind) && self.restart_burst_locked(None).await {
                    self.resolve_startup(StartupBarrierResult::Ready);
                    self.spawn_monitor();
                    StartupBarrierResult::Ready
                } else {
                    self.resolve_startup(StartupBarrierResult::Degraded);
                    StartupBarrierResult::Degraded
                }
            }
        }
    }

    pub(crate) async fn wait_startup_barrier(&self) -> StartupBarrierResult {
        let current = *self.startup_tx.borrow();
        if current != StartupBarrierResult::Pending {
            return current;
        }
        let mut receiver = self.startup_tx.subscribe();
        loop {
            if receiver.changed().await.is_err() {
                return StartupBarrierResult::Degraded;
            }
            let result = *receiver.borrow();
            if result != StartupBarrierResult::Pending {
                return result;
            }
        }
    }
}
