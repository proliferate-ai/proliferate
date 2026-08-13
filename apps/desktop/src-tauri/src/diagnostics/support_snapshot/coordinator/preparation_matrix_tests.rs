#[cfg(target_os = "macos")]
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;

use proliferate_diagnostics_protocol::v1::types::TerminalOutcomeV1;

use super::fake_runtime::FakeRuntime;
use super::lifecycle_tests::assert_lifecycle_operation;
use super::model::FinishSupportSnapshotInput;
use super::tests::{begin_input, insert_awaiting_preparation, test_coordinator};

use super::super::artifact_store::SupportArtifactStore;
use super::super::schema::enums::SupportSessionOmissionReasonV1;
use super::super::schema::model::manifest::SupportSessionCollectionManifestV1;

const SCRUB_CHILD_ENV: &str = "PROLIFERATE_PR6_SCRUB_FAILURE_CHILD";
const SCRUB_CHILD_FIXTURE: &str =
    "diagnostics::support_snapshot::coordinator::preparation_matrix_tests::scrub_failure_child";

struct PreparationTerminalCase {
    name: &'static str,
    expected_error: &'static str,
    outcome: TerminalOutcomeV1,
    classification: &'static str,
}

#[tokio::test]
async fn defensive_missing_capture_rejection_has_exact_correlation_and_one_terminal() {
    let fixture = PreparationFixture::new("rejected");
    let (operation_id, preparation_id) = fixture.admit().await;

    let error = fixture
        .coordinator
        .finish_preparation(finish_input(preparation_id))
        .await
        .expect_err("defensive missing-capture state is rejected");

    assert_preparation_terminal(
        &fixture.coordinator,
        &operation_id,
        PreparationTerminalCase {
            name: "preparation rejected",
            expected_error: "support_snapshot_preparation_rejected",
            outcome: TerminalOutcomeV1::Rejected,
            classification: "preparation_rejected",
        },
        &error,
    )
    .await;
}

#[tokio::test]
async fn manifest_invalid_has_exact_correlation_and_one_terminal() {
    let fixture = PreparationFixture::new("manifest");
    let (operation_id, preparation_id) = fixture.admit().await;
    fixture.set_empty_capture().await;
    let mut input = finish_input(preparation_id);
    input.session_evidence_json = Some("{}".to_string());

    let error = fixture
        .coordinator
        .finish_preparation(input)
        .await
        .expect_err("incoherent manifest is rejected");

    assert_preparation_terminal(
        &fixture.coordinator,
        &operation_id,
        PreparationTerminalCase {
            name: "manifest invalid",
            expected_error: "support_snapshot_manifest_invalid",
            outcome: TerminalOutcomeV1::Failed,
            classification: "manifest_invalid",
        },
        &error,
    )
    .await;
}

#[test]
fn scrub_failed_has_exact_correlation_and_one_terminal() {
    if std::env::var_os(SCRUB_CHILD_ENV).is_some() {
        return;
    }
    let marker =
        std::env::temp_dir().join(format!("pr6-scrub-failure-child-{}", uuid::Uuid::new_v4()));
    let output = Command::new(std::env::current_exe().expect("test executable"))
        .arg("--exact")
        .arg(SCRUB_CHILD_FIXTURE)
        .arg("--ignored")
        .env(SCRUB_CHILD_ENV, &marker)
        .env("HOME", "/")
        .env_remove("USERPROFILE")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("spawn scrub failure fixture");
    let marker_contents = std::fs::read_to_string(&marker).ok();
    let _ = std::fs::remove_file(marker);
    assert!(
        output.status.success(),
        "scrub failure fixture failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    assert_eq!(marker_contents.as_deref(), Some("completed"));
}

#[test]
#[ignore]
fn scrub_failure_child() {
    let Some(marker) = std::env::var_os(SCRUB_CHILD_ENV).map(PathBuf::from) else {
        return;
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime");
    runtime.block_on(async {
        let fixture = PreparationFixture::new("scrub");
        let (operation_id, preparation_id) = fixture.admit().await;
        fixture.set_empty_capture().await;
        let error = fixture
            .coordinator
            .finish_preparation(finish_input(preparation_id))
            .await
            .expect_err("root home is invalid scrub configuration");
        assert_preparation_terminal(
            &fixture.coordinator,
            &operation_id,
            PreparationTerminalCase {
                name: "scrub failed",
                expected_error: "support_snapshot_scrub_failed",
                outcome: TerminalOutcomeV1::Failed,
                classification: "scrub_failed",
            },
            &error,
        )
        .await;
    });
    std::fs::write(marker, b"completed").expect("mark scrub fixture completion");
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn artifact_verification_failed_has_exact_correlation_and_one_terminal() {
    let fixture = PreparationFixture::new("verification");
    fixture.reconcile_store();
    let (operation_id, preparation_id) = fixture.admit().await;
    fixture.set_empty_capture().await;
    deny_inherited_file_reads(fixture.store.root());

    let error = fixture
        .coordinator
        .finish_preparation(finish_input(preparation_id))
        .await
        .expect_err("safe reopen is denied");

    clear_access_control_list(fixture.store.root());
    assert_preparation_terminal(
        &fixture.coordinator,
        &operation_id,
        PreparationTerminalCase {
            name: "artifact verification failed",
            expected_error: "support_snapshot_artifact_verification_failed",
            outcome: TerminalOutcomeV1::Failed,
            classification: "artifact_verification_failed",
        },
        &error,
    )
    .await;
}

struct PreparationFixture {
    coordinator: Arc<super::SupportSnapshotCoordinator>,
    runtime: Arc<FakeRuntime>,
    #[cfg(target_os = "macos")]
    store: Arc<SupportArtifactStore>,
    root: PathBuf,
}

impl PreparationFixture {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "pr6-preparation-matrix-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&root).expect("fixture root");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                .expect("fixture root mode");
        }
        let store = Arc::new(SupportArtifactStore::for_test(
            &root,
            &root.join("attachments"),
        ));
        let runtime = Arc::new(FakeRuntime::new());
        let coordinator = test_coordinator(Some(Arc::clone(&store)), Arc::clone(&runtime));
        Self {
            coordinator,
            runtime,
            #[cfg(target_os = "macos")]
            store,
            root,
        }
    }

    #[cfg(target_os = "macos")]
    fn reconcile_store(&self) {
        self.store
            .reconcile(
                &[],
                &[],
                std::time::Instant::now() + std::time::Duration::from_secs(1),
            )
            .expect("store ready");
    }

    async fn admit(&self) -> (String, String) {
        let (_, operation, preparation_id) =
            insert_awaiting_preparation(&self.coordinator, &self.runtime).await;
        let operation_id = operation
            .lock()
            .expect("operation")
            .as_ref()
            .expect("open operation")
            .operation_id()
            .to_string();
        (operation_id, preparation_id)
    }

    async fn set_empty_capture(&self) {
        self.coordinator
            .state
            .lock()
            .await
            .preparation
            .as_mut()
            .expect("preparation")
            .captured = Some(super::test_support::empty_capture("2026-08-12T00:00:00Z"));
    }
}

impl Drop for PreparationFixture {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        clear_access_control_list(self.store.root());
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn finish_input(preparation_id: String) -> FinishSupportSnapshotInput {
    FinishSupportSnapshotInput {
        preparation_id,
        consent_epoch: "epoch-1".to_string(),
        session_evidence_json: None,
        session_collection: SupportSessionCollectionManifestV1::Omitted {
            reason: SupportSessionOmissionReasonV1::NoSelectedBundledLocalWorkspace,
        },
    }
}

async fn assert_preparation_terminal(
    coordinator: &super::SupportSnapshotCoordinator,
    operation_id: &str,
    case: PreparationTerminalCase,
    error: &str,
) {
    assert_eq!(error, case.expected_error, "{} error", case.name);
    let state = coordinator.state.lock().await;
    assert!(state.preparation.is_none(), "{} clears state", case.name);
    assert!(
        state.artifacts.is_empty(),
        "{} authorizes nothing",
        case.name
    );
    assert!(
        state.read_proofs.is_empty(),
        "{} retains no verification proof",
        case.name
    );
    assert!(
        state.submission.is_none(),
        "{} admits no submission",
        case.name
    );
    drop(state);
    assert_lifecycle_operation(
        coordinator,
        "desktop.support_snapshot.prepare",
        Some(operation_id),
        &begin_input().client_job_id,
        None,
        case.outcome,
        Some(case.classification),
        None,
    );
}

#[cfg(target_os = "macos")]
fn deny_inherited_file_reads(root: &Path) {
    let user = std::env::var("USER").expect("test user");
    let entry = format!("user:{user} deny read,file_inherit,only_inherit");
    let status = Command::new("/bin/chmod")
        .arg("+a")
        .arg(entry)
        .arg(root)
        .status()
        .expect("install verification ACL");
    assert!(status.success(), "install verification ACL");
}

#[cfg(target_os = "macos")]
fn clear_access_control_list(root: &Path) {
    if root.exists() {
        let _ = Command::new("/bin/chmod").arg("-RN").arg(root).status();
    }
}
