use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use proliferate_diagnostics_protocol::v1::types::{
    ComponentV1, FallbackHealthV1, HealthResponseV1, IngestBatchV1, IngestReceiptV1, SourceV1,
    TerminalOutcomeV1,
};
use proliferate_diagnostics_protocol::v1::validation::parse_ingest_batch_value;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use super::export_admission::ExportAdmission;
use super::fallback::FallbackDiagnosticsWriter;
use super::producer::TauriDiagnosticsProducer;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CollectorLaunchKindV1 {
    Initial,
    AutomaticRestart,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DesktopDiagnosticsSupervisorStateV1 {
    Unsupported {
        classification: String,
    },
    Starting {
        launch_kind: CollectorLaunchKindV1,
        attempt: u8,
        restart_count: u64,
    },
    Ready {
        collector_boot_id: String,
        schema_major: u16,
        restart_count: u64,
    },
    Degraded {
        classification: String,
        restart_count: u64,
        retry_exhausted: bool,
    },
    Stopped {
        orderly: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopDiagnosticsHealthV1 {
    pub supervisor: DesktopDiagnosticsSupervisorStateV1,
    pub fallback: FallbackHealthV1,
    pub collector: Option<HealthResponseV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StartupBarrierResult {
    Pending,
    Ready,
    Degraded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SupervisorUnavailable {
    Starting,
    Unsupported,
    Degraded,
    Stopped,
    Replaced,
    ShuttingDown,
    CollectorRejected,
    Deadline,
    Protocol,
}

impl SupervisorUnavailable {
    pub(crate) const fn classification(self) -> &'static str {
        match self {
            Self::Starting => "collector_starting",
            Self::Unsupported => "collector_unsupported",
            Self::Degraded => "collector_degraded",
            Self::Stopped => "collector_stopped",
            Self::Replaced => "collector_replaced",
            Self::ShuttingDown => "broker_shutting_down",
            Self::CollectorRejected => "collector_rejected",
            Self::Deadline => "deadline_exceeded",
            Self::Protocol => "protocol_error",
        }
    }
}

pub(crate) struct DiagnosticsCollectorSupervisor {
    producer: TauriDiagnosticsProducer,
    fallback: FallbackDiagnosticsWriter,
    state: Mutex<DesktopDiagnosticsSupervisorStateV1>,
    startup_tx: watch::Sender<StartupBarrierResult>,
    generation_tx: watch::Sender<u64>,
    shutdown_tx: watch::Sender<bool>,
    export_admission: Arc<ExportAdmission>,
    started: AtomicBool,
    shutdown_armed: AtomicBool,
}

impl DiagnosticsCollectorSupervisor {
    pub(crate) fn new(
        producer: TauriDiagnosticsProducer,
        fallback: FallbackDiagnosticsWriter,
        _release: String,
        _environment: String,
        // Targets that reach this file ship a placeholder collector, so there
        // is no process to stamp the install id onto and nothing to export it
        // on. The parameter exists so both supervisors present one signature
        // to `lib.rs`, which cannot know which one it compiled against.
        _install_id: Option<String>,
    ) -> Arc<Self> {
        let (startup_tx, _) = watch::channel(StartupBarrierResult::Pending);
        let (generation_tx, _) = watch::channel(0);
        let (shutdown_tx, _) = watch::channel(false);
        Arc::new(Self {
            producer,
            fallback,
            state: Mutex::new(DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: false }),
            startup_tx,
            generation_tx,
            shutdown_tx,
            export_admission: ExportAdmission::shared_capacity_one(),
            started: AtomicBool::new(false),
            shutdown_armed: AtomicBool::new(false),
        })
    }

    pub(crate) fn state(&self) -> DesktopDiagnosticsSupervisorStateV1 {
        self.state.lock().map(|state| state.clone()).unwrap_or(
            DesktopDiagnosticsSupervisorStateV1::Unsupported {
                classification: "unsupported_target".to_string(),
            },
        )
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
        if self.started.swap(true, Ordering::AcqRel) {
            return *self.startup_tx.borrow();
        }
        let operation = self.producer.begin_lifecycle("desktop.collector.start");
        let unsupported = DesktopDiagnosticsSupervisorStateV1::Unsupported {
            classification: "unsupported_target".to_string(),
        };
        if let Ok(mut state) = self.state.lock() {
            *state = unsupported;
        }
        self.fallback.set_active(true);
        operation.terminal(TerminalOutcomeV1::Skipped, Some("unsupported_target"));
        self.startup_tx.send_replace(StartupBarrierResult::Degraded);
        StartupBarrierResult::Degraded
    }

    pub(crate) async fn wait_startup_barrier(&self) -> StartupBarrierResult {
        let mut receiver = self.startup_tx.subscribe();
        loop {
            let current = *receiver.borrow();
            if current != StartupBarrierResult::Pending {
                return current;
            }
            if receiver.changed().await.is_err() {
                return StartupBarrierResult::Degraded;
            }
        }
    }

    pub(crate) async fn health(&self) -> DesktopDiagnosticsHealthV1 {
        DesktopDiagnosticsHealthV1 {
            supervisor: self.state(),
            fallback: self.fallback.health(),
            collector: None,
        }
    }

    pub(crate) async fn ingest_renderer(
        &self,
        batch: IngestBatchV1,
    ) -> Result<IngestReceiptV1, SupervisorUnavailable> {
        if batch.records.is_empty()
            || batch.records.iter().any(|record| {
                record.component != ComponentV1::DesktopRenderer
                    || record.source != SourceV1::Renderer
            })
        {
            return Err(SupervisorUnavailable::CollectorRejected);
        }
        let value = serde_json::to_value(&batch).map_err(|_| SupervisorUnavailable::Protocol)?;
        parse_ingest_batch_value(&value).map_err(|_| SupervisorUnavailable::CollectorRejected)?;
        let error = if self.shutdown_is_armed() {
            SupervisorUnavailable::ShuttingDown
        } else {
            SupervisorUnavailable::Unsupported
        };
        for record in &batch.records {
            if let Ok(serialized) = serde_json::to_string(record) {
                let _ = self.fallback.record_pre_dispatch_renderer(&serialized);
            }
        }
        Err(error)
    }

    pub(crate) fn arm_shutdown(&self) -> bool {
        if self.shutdown_armed.swap(true, Ordering::AcqRel) {
            return false;
        }
        if *self.startup_tx.borrow() == StartupBarrierResult::Pending {
            self.startup_tx.send_replace(StartupBarrierResult::Degraded);
        }
        self.shutdown_tx.send_replace(true);
        true
    }

    pub(crate) async fn stop_collector(&self) -> Result<(), SupervisorUnavailable> {
        let operation = self.producer.begin_lifecycle("desktop.collector.stop");
        let generation = (*self.generation_tx.borrow()).saturating_add(1);
        self.generation_tx.send_replace(generation);
        self.producer.set_ready_client(generation, None);
        operation.terminal(TerminalOutcomeV1::Skipped, None);
        if let Ok(mut state) = self.state.lock() {
            *state = DesktopDiagnosticsSupervisorStateV1::Stopped { orderly: true };
        }
        Ok(())
    }
}
