use std::sync::{Arc, Mutex as StdMutex};
use std::{future::Future, pin::Pin};

use chrono::{DateTime, Utc};
use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;
use tokio::time::{Duration, Instant};

use super::super::artifact_store::SupportArtifactStore;
use super::super::schema::enums::SupportSessionOmissionReasonV1;
use super::super::schema::model::manifest::SupportSessionCollectionManifestV1;
use super::control::{PreparationControl, PreparationInterruption};
use super::lifecycle_tests::assert_lifecycle_pair;
use super::model::{
    BeginSupportSnapshotInput, CancelSupportSnapshotInput, DeleteStagedSupportSnapshotInput,
    NoWorkspaceReason, SupportSnapshotConsentInput, SupportSnapshotSelectionInput,
    SupportSnapshotWorkspaceInput, DISCLOSURE_VERSION,
};
use super::runtime::CoordinatorRuntime;
use super::state::{ArtifactAuthorization, OpenPreparation, PreparationPhase, ReadinessState};
use super::SupportSnapshotCoordinator;
use crate::commands::cloud_worker::create_cloud_worker_state;
use crate::diagnostics_collector::fallback::FallbackDiagnosticsWriter;
use crate::diagnostics_collector::producer::TauriDiagnosticsProducer;
use crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor;
use crate::sidecar::create_sidecar;

pub(super) struct FakeRuntime {
    clock: Arc<FakeClock>,
    next_id: StdMutex<u64>,
}

struct FakeClock {
    utc: StdMutex<DateTime<Utc>>,
    instant: StdMutex<Instant>,
    advanced: tokio::sync::Notify,
}

impl FakeRuntime {
    pub(super) fn new() -> Self {
        Self {
            clock: Arc::new(FakeClock {
                utc: StdMutex::new(
                    DateTime::parse_from_rfc3339("2026-08-12T00:00:00Z")
                        .expect("time")
                        .with_timezone(&Utc),
                ),
                instant: StdMutex::new(Instant::now()),
                advanced: tokio::sync::Notify::new(),
            }),
            next_id: StdMutex::new(0),
        }
    }

    pub(super) fn advance(&self, duration: Duration) {
        let mut instant = self.clock.instant.lock().expect("fake instant");
        *instant += duration;
        let mut utc = self.clock.utc.lock().expect("fake utc");
        *utc += chrono::Duration::from_std(duration).expect("fake duration");
        self.clock.advanced.notify_waiters();
    }
}

impl CoordinatorRuntime for FakeRuntime {
    fn utc_now(&self) -> DateTime<Utc> {
        self.clock.utc.lock().expect("fake utc").to_owned()
    }

    fn instant_now(&self) -> Instant {
        *self.clock.instant.lock().expect("fake instant")
    }

    fn new_id(&self) -> String {
        let mut next = self.next_id.lock().expect("fake id");
        *next += 1;
        uuid::Uuid::from_u128(*next as u128).to_string()
    }

    fn sleep_until(&self, deadline: Instant) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let clock = Arc::clone(&self.clock);
        Box::pin(async move {
            loop {
                let advanced = clock.advanced.notified();
                if *clock.instant.lock().expect("fake instant") >= deadline {
                    return;
                }
                advanced.await;
            }
        })
    }
}

pub(super) fn test_coordinator(
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

pub(super) fn reference() -> super::super::artifact_store::SupportArtifactReference {
    let client_job_id = uuid::Uuid::from_u128(7).to_string();
    super::super::artifact_store::SupportArtifactReference {
        artifact_id: SupportArtifactStore::artifact_id(&client_job_id).expect("artifact id"),
        client_job_id,
        snapshot_id: uuid::Uuid::from_u128(8).to_string(),
        size_bytes: 1,
        sha256: "b".repeat(64),
    }
}

pub(super) fn begin_input() -> BeginSupportSnapshotInput {
    BeginSupportSnapshotInput {
        client_job_id: uuid::Uuid::from_u128(7).to_string(),
        report_opened_at: "2026-08-11T23:59:00Z".to_string(),
        consent_epoch: "epoch-1".to_string(),
        consent: SupportSnapshotConsentInput {
            version: 1,
            disclosure_version: DISCLOSURE_VERSION.to_string(),
            granted_at: "2026-08-12T00:00:00Z".to_string(),
            selection: SupportSnapshotSelectionInput::RecentActivity {
                workspace: SupportSnapshotWorkspaceInput::None {
                    reason: NoWorkspaceReason::NoSelectedBundledLocalWorkspace,
                },
            },
        },
    }
}

pub(super) async fn insert_awaiting_preparation(
    coordinator: &Arc<SupportSnapshotCoordinator>,
    runtime: &Arc<FakeRuntime>,
) -> (
    Arc<PreparationControl>,
    Arc<StdMutex<Option<crate::diagnostics_collector::producer::lifecycle::support_lifecycle::SupportPreparationOperation>>>,
    String,
){
    let input = begin_input();
    let preparation_id = uuid::Uuid::from_u128(9).to_string();
    let operation = coordinator
        .producer
        .begin_support_snapshot_preparation(&input.client_job_id)
        .expect("admitted preparation");
    let operation_id = operation.operation_id().to_string();
    let operation = Arc::new(StdMutex::new(Some(operation)));
    let control = PreparationControl::new();
    let deadline = runtime.instant_now() + Duration::from_secs(25);
    let mut state = coordinator.state.lock().await;
    state.readiness = ReadinessState::Ready;
    state.preparation = Some(OpenPreparation {
        input,
        preparation_id: preparation_id.clone(),
        snapshot_id: uuid::Uuid::from_u128(10).to_string(),
        preparation_operation_id: operation_id,
        captured_at: "2026-08-12T00:00:00Z".to_string(),
        source_time_from: "2026-08-11T23:45:00Z".to_string(),
        source_time_to: "2026-08-12T00:00:00Z".to_string(),
        deadline,
        phase: PreparationPhase::AwaitingFinish,
        control: Arc::clone(&control),
        operation: Arc::clone(&operation),
        captured: None,
        session_phase_started_at: Some("2026-08-12T00:00:01Z".to_string()),
    });
    drop(state);
    super::watchdog::spawn_preparation_watchdog(
        coordinator,
        preparation_id.clone(),
        deadline,
        Arc::clone(&control),
    );
    (control, operation, preparation_id)
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
async fn awaiting_finish_watchdog_owns_the_absolute_terminal() {
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(None, Arc::clone(&runtime));
    let (control, operation, _) = insert_awaiting_preparation(&coordinator, &runtime).await;

    runtime.advance(Duration::from_secs(25));
    control.wait_idle().await;

    let state = coordinator.state.lock().await;
    assert!(state.preparation.is_none());
    assert_eq!(
        state
            .closed_preparation
            .as_ref()
            .map(|closed| closed.interruption),
        Some(PreparationInterruption::Deadline)
    );
    assert!(operation.lock().expect("operation").is_none());
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::TimedOut,
        Some("preparation_timeout"),
        None,
    );
}

#[tokio::test]
async fn admitted_capture_guard_is_owned_until_begin_returns() {
    let control = PreparationControl::new();
    let begin_call = control.begin_work();
    assert_eq!(control.active_work(), 1);
    assert!(control.request(PreparationInterruption::Cancelled));
    let waiting = control.wait_idle();
    tokio::pin!(waiting);
    assert!(tokio::time::timeout(Duration::from_millis(1), &mut waiting)
        .await
        .is_err());
    drop(begin_call);
    waiting.await;
}

#[tokio::test]
async fn explicit_cancel_beats_a_later_deadline_and_returns_after_idle() {
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(None, Arc::clone(&runtime));
    let (control, operation, preparation_id) =
        insert_awaiting_preparation(&coordinator, &runtime).await;
    coordinator
        .cancel_preparation(CancelSupportSnapshotInput {
            client_job_id: begin_input().client_job_id,
            consent_epoch: "epoch-1".to_string(),
            preparation_id: Some(preparation_id),
        })
        .await
        .expect("cancel");
    runtime.advance(Duration::from_secs(25));

    assert_eq!(control.interruption(), PreparationInterruption::Cancelled);
    assert!(operation.lock().expect("operation").is_none());
    assert_eq!(
        coordinator
            .state
            .lock()
            .await
            .closed_preparation
            .as_ref()
            .map(|closed| closed.interruption),
        Some(PreparationInterruption::Cancelled)
    );
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::Cancelled,
        None,
        None,
    );
}

#[tokio::test]
async fn shutdown_closes_admission_and_waits_for_active_support_work() {
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(None, Arc::clone(&runtime));
    let (control, operation, _) = insert_awaiting_preparation(&coordinator, &runtime).await;
    let work = control.begin_work();
    let shutdown = coordinator.cancel_support();
    tokio::pin!(shutdown);
    assert!(
        tokio::time::timeout(Duration::from_millis(1), &mut shutdown)
            .await
            .is_err()
    );
    drop(work);
    shutdown.await;

    let state = coordinator.state.lock().await;
    assert!(state.shutdown_armed);
    assert!(state.preparation.is_none());
    assert!(operation.lock().expect("operation").is_none());
    assert_eq!(control.interruption(), PreparationInterruption::Abandoned);
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::Abandoned,
        None,
        None,
    );
}

#[tokio::test]
async fn every_reentrant_shutdown_waits_on_the_same_active_fence() {
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(None, Arc::clone(&runtime));
    let (control, _, _) = insert_awaiting_preparation(&coordinator, &runtime).await;
    let work = control.begin_work();
    let first = coordinator.cancel_support();
    tokio::pin!(first);
    assert!(tokio::time::timeout(Duration::from_millis(1), &mut first)
        .await
        .is_err());
    let second = coordinator.cancel_support();
    tokio::pin!(second);
    assert!(tokio::time::timeout(Duration::from_millis(1), &mut second)
        .await
        .is_err());
    drop(work);
    tokio::join!(first, second);
    assert!(coordinator.state.lock().await.closing_preparation.is_none());
}

#[tokio::test]
async fn final_capture_boundary_cannot_admit_after_absolute_deadline() {
    let runtime = FakeRuntime::new();
    let control = PreparationControl::new();
    let deadline = runtime.instant_now() + Duration::from_secs(25);
    runtime.advance(Duration::from_secs(25));
    if control.interruption() == PreparationInterruption::Running
        && runtime.instant_now() >= deadline
    {
        control.request(PreparationInterruption::Deadline);
    }
    assert_eq!(control.interruption(), PreparationInterruption::Deadline);
}

#[tokio::test]
async fn unknown_delete_is_ready_idempotent_without_filesystem_authority() {
    let root = std::env::temp_dir().join(format!("pr6-delete-{}", uuid::Uuid::new_v4()));
    let store = Arc::new(SupportArtifactStore::for_test(
        &root,
        &root.join("attachments"),
    ));
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(Some(Arc::clone(&store)), runtime);
    coordinator.state.lock().await.readiness = ReadinessState::Ready;
    let artifact_id = format!("ssv1_{}", "a".repeat(64));
    std::fs::create_dir_all(store.root()).expect("root");
    let path = store.root().join(format!("{artifact_id}.json"));
    std::fs::write(&path, b"must remain").expect("rogue artifact");

    let publication = coordinator.artifact_gate.lock().await;
    let deletion = coordinator.delete_artifact(DeleteStagedSupportSnapshotInput { artifact_id });
    tokio::pin!(deletion);
    assert!(
        tokio::time::timeout(Duration::from_millis(1), &mut deletion)
            .await
            .is_err()
    );
    drop(publication);
    deletion.await.expect("unknown delete is idempotent");
    assert!(path.exists());
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn admitted_finish_publishes_one_authorization_and_one_terminal() {
    use std::os::unix::fs::PermissionsExt;

    let root = std::env::temp_dir().join(format!("pr6-finish-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).expect("app root");
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).expect("app root mode");
    let store = Arc::new(SupportArtifactStore::for_test(
        &root,
        &root.join("attachments"),
    ));
    store
        .reconcile(
            &[],
            &[],
            std::time::Instant::now() + std::time::Duration::from_secs(1),
        )
        .expect("store ready");
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(Some(store), Arc::clone(&runtime));
    let (_control, operation, preparation_id) =
        insert_awaiting_preparation(&coordinator, &runtime).await;
    coordinator
        .state
        .lock()
        .await
        .preparation
        .as_mut()
        .expect("preparation")
        .captured = Some(super::test_support::empty_capture("2026-08-12T00:00:00Z"));

    let output = coordinator
        .finish_preparation(super::model::FinishSupportSnapshotInput {
            preparation_id,
            consent_epoch: "epoch-1".to_string(),
            session_evidence_json: None,
            session_collection: SupportSessionCollectionManifestV1::Omitted {
                reason: SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace,
            },
        })
        .await
        .expect("finish");

    let state = coordinator.state.lock().await;
    assert!(state.preparation.is_none());
    assert_eq!(state.artifacts.len(), 1);
    assert!(state.artifacts.contains_key(&output.artifact_id));
    assert!(operation.lock().expect("operation").is_none());
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::Succeeded,
        None,
        None,
    );
    drop(state);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn admitted_finish_failure_emits_one_classified_terminal() {
    let root = std::env::temp_dir().join(format!("pr6-finish-failure-{}", uuid::Uuid::new_v4()));
    let store = Arc::new(SupportArtifactStore::for_test(
        &root,
        &root.join("attachments"),
    ));
    let runtime = Arc::new(FakeRuntime::new());
    let coordinator = test_coordinator(Some(store), Arc::clone(&runtime));
    let (_, operation, preparation_id) = insert_awaiting_preparation(&coordinator, &runtime).await;
    coordinator
        .state
        .lock()
        .await
        .preparation
        .as_mut()
        .expect("preparation")
        .captured = Some(super::test_support::empty_capture("2026-08-12T00:00:00Z"));

    let error = coordinator
        .finish_preparation(super::model::FinishSupportSnapshotInput {
            preparation_id,
            consent_epoch: "epoch-1".to_string(),
            session_evidence_json: None,
            session_collection: SupportSessionCollectionManifestV1::Omitted {
                reason: SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace,
            },
        })
        .await
        .expect_err("unreconciled store rejects stage");

    assert_eq!(error, "support_snapshot_stage_failed");
    assert!(coordinator.state.lock().await.preparation.is_none());
    assert!(operation.lock().expect("operation").is_none());
    assert_lifecycle_pair(
        &coordinator,
        "desktop.support_snapshot.prepare",
        &begin_input().client_job_id,
        None,
        TerminalOutcomeV1::Failed,
        Some("stage_failed"),
        None,
    );
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
    let control = super::control::PreparationControl::new();
    let overall_deadline = runtime.instant_now() + Duration::from_secs(25);
    let finish_deadline = overall_deadline.min(runtime.instant_now() + Duration::from_secs(10));
    assert_eq!(
        super::finish::check_finish(&control, finish_deadline, &runtime),
        Ok(())
    );
    runtime.advance(Duration::from_secs(10));
    assert_eq!(
        super::finish::check_finish(&control, finish_deadline, &runtime),
        Err(super::finish::FinishError::Deadline)
    );

    let runtime = FakeRuntime::new();
    let control = super::control::PreparationControl::new();
    let deadline = runtime.instant_now() + Duration::from_secs(25);
    control.request(super::control::PreparationInterruption::Cancelled);
    assert_eq!(
        super::finish::check_finish(&control, deadline, &runtime),
        Err(super::finish::FinishError::Cancelled)
    );
}
