mod artifacts;
mod byte_allocation;
mod capture;
mod file_accounting;
mod finish;
pub(crate) mod model;
mod preparation;
mod runtime;
mod session_accounting;
mod session_cross_check;
mod session_input;
mod session_values;
mod state;
mod submission;
mod submission_flow;

use std::sync::Arc;

use tokio::sync::Mutex;

use crate::commands::cloud_worker::SharedCloudWorkerState;
use crate::diagnostics_collector::producer::TauriDiagnosticsProducer;
use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;
use crate::sidecar::SharedSidecar;

use super::artifact_store::SupportArtifactStore;
use runtime::{CoordinatorRuntime, SystemCoordinatorRuntime};
use state::CoordinatorState;

/// The sole native owner of consented snapshot preparation and submit
/// lifecycle authority. Construction is fail-closed: an unavailable artifact
/// store keeps the app booting but cannot become ready.
pub(crate) struct SupportSnapshotCoordinator {
    pub(super) state: Mutex<CoordinatorState>,
    pub(super) store: Option<Arc<SupportArtifactStore>>,
    pub(super) supervisor: Arc<DiagnosticsCollectorSupervisor>,
    pub(super) producer: TauriDiagnosticsProducer,
    pub(super) worker: SharedCloudWorkerState,
    pub(super) sidecar: SharedSidecar,
    pub(super) runtime: Arc<dyn CoordinatorRuntime>,
}

impl SupportSnapshotCoordinator {
    pub(crate) fn new(
        supervisor: Arc<DiagnosticsCollectorSupervisor>,
        producer: TauriDiagnosticsProducer,
        worker: SharedCloudWorkerState,
        sidecar: SharedSidecar,
    ) -> Arc<Self> {
        Self::with_runtime(
            supervisor,
            producer,
            worker,
            sidecar,
            Arc::new(SystemCoordinatorRuntime),
        )
    }

    fn with_runtime(
        supervisor: Arc<DiagnosticsCollectorSupervisor>,
        producer: TauriDiagnosticsProducer,
        worker: SharedCloudWorkerState,
        sidecar: SharedSidecar,
        runtime: Arc<dyn CoordinatorRuntime>,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(CoordinatorState::default()),
            store: SupportArtifactStore::new().ok().map(Arc::new),
            supervisor,
            producer,
            worker,
            sidecar,
            runtime,
        })
    }

    #[cfg(test)]
    fn with_test_parts(
        supervisor: Arc<DiagnosticsCollectorSupervisor>,
        producer: TauriDiagnosticsProducer,
        worker: SharedCloudWorkerState,
        sidecar: SharedSidecar,
        store: Option<Arc<SupportArtifactStore>>,
        runtime: Arc<dyn CoordinatorRuntime>,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(CoordinatorState::default()),
            store,
            supervisor,
            producer,
            worker,
            sidecar,
            runtime,
        })
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
