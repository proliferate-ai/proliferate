use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex as StdMutex,
};

use chrono::{DateTime, Utc};
use tokio::time::{Duration, Instant};

use super::super::artifact_store::SupportArtifactStore;
use super::runtime::CoordinatorRuntime;
use super::state::{ArtifactAuthorization, ReadinessState};
use super::SupportSnapshotCoordinator;
use crate::commands::cloud_worker::create_cloud_worker_state;
use crate::diagnostics_collector::fallback::FallbackDiagnosticsWriter;
use crate::diagnostics_collector::producer::TauriDiagnosticsProducer;
use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;
use crate::sidecar::create_sidecar;

struct FakeRuntime {
    utc: DateTime<Utc>,
    instant: StdMutex<Instant>,
    next_id: StdMutex<u64>,
}

impl FakeRuntime {
    fn new() -> Self {
        Self {
            utc: DateTime::parse_from_rfc3339("2026-08-12T00:00:00Z")
                .expect("time")
                .with_timezone(&Utc),
            instant: StdMutex::new(Instant::now()),
            next_id: StdMutex::new(0),
        }
    }

    fn advance(&self, duration: Duration) {
        let mut instant = self.instant.lock().expect("fake instant");
        *instant += duration;
    }
}

impl CoordinatorRuntime for FakeRuntime {
    fn utc_now(&self) -> DateTime<Utc> {
        self.utc.clone()
    }

    fn instant_now(&self) -> Instant {
        *self.instant.lock().expect("fake instant")
    }

    fn new_id(&self) -> String {
        let mut next = self.next_id.lock().expect("fake id");
        *next += 1;
        uuid::Uuid::from_u128(*next as u128).to_string()
    }
}

fn test_coordinator(
    store: Option<Arc<SupportArtifactStore>>,
    runtime: Arc<FakeRuntime>,
) -> Arc<SupportSnapshotCoordinator> {
    let fallback = FallbackDiagnosticsWriter::default();
    let producer =
        TauriDiagnosticsProducer::new(fallback.clone(), "test".to_string(), "test".to_string());
    let supervisor = DiagnosticsCollectorSupervisor::new(
        producer.clone(),
        fallback,
        "test".to_string(),
        "test".to_string(),
    );
    SupportSnapshotCoordinator::with_test_parts(
        supervisor,
        producer,
        create_cloud_worker_state(),
        create_sidecar(49_902),
        store,
        runtime,
    )
}

fn reference() -> super::super::artifact_store::SupportArtifactReference {
    let client_job_id = uuid::Uuid::from_u128(7).to_string();
    super::super::artifact_store::SupportArtifactReference {
        artifact_id: SupportArtifactStore::artifact_id(&client_job_id).expect("artifact id"),
        client_job_id,
        snapshot_id: uuid::Uuid::from_u128(8).to_string(),
        size_bytes: 1,
        sha256: "b".repeat(64),
    }
}

#[tokio::test]
async fn unavailable_store_stays_fail_closed_without_blocking_construction() {
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(None, runtime);
    assert_eq!(
        coordinator.state.lock().await.readiness,
        ReadinessState::Unreconciled
    );
    assert!(coordinator.store.is_none());
}

#[tokio::test]
async fn support_shutdown_arm_is_reentrant_and_permanently_closes_admission() {
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(None, runtime);
    let ((), ()) = tokio::join!(coordinator.cancel_support(), coordinator.cancel_support());
    let state = coordinator.state.lock().await;
    assert!(state.shutdown_armed);
    assert!(state.preparation.is_none());
    assert!(state.submission.is_none());
}

#[tokio::test]
async fn fake_clock_purges_one_use_read_proofs_at_the_exact_expiry() {
    let root = std::env::temp_dir().join(format!("pr6-coordinator-{}", uuid::Uuid::new_v4()));
    let store = Arc::new(SupportArtifactStore::for_test(
        &root,
        &root.join("attachments"),
    ));
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(Some(store), Arc::clone(&runtime));
    let reference = reference();
    {
        let mut state = coordinator.state.lock().await;
        state.artifacts.insert(
            reference.artifact_id.clone(),
            ArtifactAuthorization {
                reference: reference.clone(),
                preparation_id: None,
                preparation_operation_id: None,
                consent_epoch: None,
            },
        );
        state.read_proofs.insert(
            reference.artifact_id.clone(),
            super::state::ReadVerificationProof {
                reference,
                expires_at: runtime.instant_now() + Duration::from_secs(30),
            },
        );
    }
    runtime.advance(Duration::from_secs(30));
    let mut state = coordinator.state.lock().await;
    state.purge_expired_proofs(runtime.instant_now());
    assert!(state.read_proofs.is_empty());
    assert_eq!(state.artifacts.len(), 1);
}

#[test]
fn fake_clock_owns_the_shared_absolute_finish_deadline_and_cancel_precedes_it() {
    let runtime = FakeRuntime::new();
    let cancelled = AtomicBool::new(false);
    let overall_deadline = runtime.instant_now() + Duration::from_secs(25);
    let finish_deadline = overall_deadline.min(runtime.instant_now() + Duration::from_secs(10));
    assert_eq!(
        super::finish::check_finish(&cancelled, finish_deadline, &runtime),
        Ok(())
    );
    runtime.advance(Duration::from_secs(10));
    assert_eq!(
        super::finish::check_finish(&cancelled, finish_deadline, &runtime),
        Err(super::finish::FinishError::Deadline)
    );

    let runtime = FakeRuntime::new();
    let deadline = runtime.instant_now() + Duration::from_secs(25);
    cancelled.store(true, Ordering::Release);
    assert_eq!(
        super::finish::check_finish(&cancelled, deadline, &runtime),
        Err(super::finish::FinishError::Cancelled)
    );
}
