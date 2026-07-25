use super::*;
use crate::process_env::complete_workflow_operation_env;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

fn identity(run_id: &str) -> WorkflowDeliveryIdentity {
    WorkflowDeliveryIdentity::try_new(
        run_id,
        Some("sha256:1111111111111111111111111111111111111111111111111111111111111111"),
        Some("sha256:2222222222222222222222222222222222222222222222222222222222222222"),
        Some(7),
    )
    .expect("identity")
}

fn guarantees() -> Vec<WorkflowIsolationGuarantee> {
    REQUIRED_GUARANTEES.to_vec()
}
struct RecordingBroker {
    identity: WorkflowDeliveryIdentity,
    cancelled_groups: AtomicUsize,
    command_calls: AtomicUsize,
    revoked: AtomicBool,
    output_bytes: usize,
}

#[async_trait::async_trait]
impl WorkflowIsolationBroker for RecordingBroker {
    fn attest(
        &self,
        _identity: &WorkflowDeliveryIdentity,
        policy: &WorkflowIsolationPolicy,
    ) -> Result<WorkflowIsolationAttestation, WorkflowIsolationError> {
        WorkflowIsolationAttestation::new(
            "cap-1",
            self.identity.clone(),
            "test-backend-v1",
            policy.version(),
            1,
            policy.digest(),
            WorkflowIsolationEnforcement::PlatformSandbox,
            guarantees(),
        )
    }

    fn spawn_agent(
        &self,
        _capability: &WorkflowIsolationCapability,
        _request: WorkflowAgentLaunchRequest,
    ) -> Result<BrokeredWorkflowAgentProcess, WorkflowIsolationError> {
        unreachable!()
    }

    fn authorize_executable(
        &self,
        capability: &WorkflowIsolationCapability,
        identity: &WorkflowProcessIdentity,
        requested_program: &std::path::Path,
    ) -> Result<WorkflowExecutableAuthorization, WorkflowIsolationError> {
        WorkflowExecutableAuthorization::try_new(
            identity.clone(),
            requested_program.to_path_buf(),
            requested_program.to_path_buf(),
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            capability.identity().execution_generation(),
            capability.broker_generation(),
        )
    }

    fn bind_local_gateway(
        &self,
        capability: &WorkflowIsolationCapability,
        identity: &WorkflowProcessIdentity,
    ) -> Result<TrustedLocalGatewayBinding, WorkflowIsolationError> {
        if self.revoked.load(Ordering::SeqCst) {
            return Err(WorkflowIsolationError::Cancelled);
        }
        let WorkflowProcessSubject::Session { session_id, .. } = identity.subject() else {
            return Err(WorkflowIsolationError::RequestIdentityMismatch);
        };
        TrustedLocalGatewayBinding::try_new(
            "http://127.0.0.1:43891/mcp",
            session_id,
            capability.identity().execution_generation(),
            capability.broker_generation(),
            "local-session-capability",
        )
    }

    async fn run_command(
        &self,
        _capability: &WorkflowIsolationCapability,
        _request: WorkflowCommandRequest,
    ) -> Result<WorkflowCommandOutput, WorkflowIsolationError> {
        self.command_calls.fetch_add(1, Ordering::SeqCst);
        Ok(WorkflowCommandOutput {
            exit_code: Some(0),
            stdout: vec![b'x'; self.output_bytes],
            stderr: Vec::new(),
        })
    }

    async fn cancel_process_group(
        &self,
        _capability: &WorkflowIsolationCapability,
        _process_group: &WorkflowProcessGroup,
    ) -> Result<(), WorkflowIsolationError> {
        self.cancelled_groups.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn cancel_run(
        &self,
        _capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowIsolationError> {
        self.revoked.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn notify_step_transition(
        &self,
        _capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowIsolationError> {
        Ok(())
    }
}

#[tokio::test]
async fn explicit_process_guard_quiescence_disarms_drop_fallback() {
    let identity = identity("run-1");
    let broker = Arc::new(RecordingBroker {
        identity: identity.clone(),
        cancelled_groups: AtomicUsize::new(0),
        command_calls: AtomicUsize::new(0),
        revoked: AtomicBool::new(false),
        output_bytes: 0,
    });
    let capability =
        attest_workflow_isolation(broker.as_ref(), &identity, &test_isolation_policy())
            .expect("attest");
    let process_identity =
        WorkflowProcessIdentity::try_session(identity.clone(), "main", "session-1", "/tmp")
            .expect("process identity");
    let process_group = WorkflowProcessGroup::try_new(
        "process-group-1",
        process_identity,
        identity.execution_generation(),
        capability.broker_generation(),
    )
    .expect("group");
    let mut guard = WorkflowProcessGroupGuard::new(broker.clone(), capability, process_group);
    guard
        .quiesce()
        .await
        .expect("synchronous process-group cleanup");
    drop(guard);
    assert_eq!(broker.cancelled_groups.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn dropping_armed_process_guard_is_only_an_emergency_cleanup_retry() {
    let identity = identity("run-drop-fallback");
    let broker = Arc::new(RecordingBroker {
        identity: identity.clone(),
        cancelled_groups: AtomicUsize::new(0),
        command_calls: AtomicUsize::new(0),
        revoked: AtomicBool::new(false),
        output_bytes: 0,
    });
    let capability =
        attest_workflow_isolation(broker.as_ref(), &identity, &test_isolation_policy())
            .expect("attest");
    let process_identity =
        WorkflowProcessIdentity::try_session(identity.clone(), "main", "session-1", "/tmp")
            .expect("process identity");
    let process_group = WorkflowProcessGroup::try_new(
        "process-group-drop-fallback",
        process_identity,
        identity.execution_generation(),
        capability.broker_generation(),
    )
    .expect("group");
    drop(WorkflowProcessGroupGuard::new(
        broker.clone(),
        capability,
        process_group,
    ));
    for _ in 0..20 {
        if broker.cancelled_groups.load(Ordering::SeqCst) == 1 {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert_eq!(broker.cancelled_groups.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn common_boundary_rejects_request_identity_before_adapter_call() {
    let attested_identity = identity("run-1");
    let broker = RecordingBroker {
        identity: attested_identity.clone(),
        cancelled_groups: AtomicUsize::new(0),
        command_calls: AtomicUsize::new(0),
        revoked: AtomicBool::new(false),
        output_bytes: 0,
    };
    let capability =
        attest_workflow_isolation(&broker, &attested_identity, &test_isolation_policy())
            .expect("attest run-1");
    let request = WorkflowCommandRequest {
        identity: WorkflowProcessIdentity::new(
            identity("run-2"),
            WorkflowProcessSubject::Step {
                step_key: "root::node::-::step".to_string(),
                attempt: 1,
                kind: WorkflowCommandKind::Shell,
                root: PathBuf::from("/tmp"),
            },
        ),
        program: "/bin/true".into(),
        args: Vec::new(),
        cwd: "/tmp".into(),
        env: complete_workflow_operation_env(Vec::new()),
        timeout: Duration::from_secs(1),
        max_stdout_bytes: WORKFLOW_COMMAND_STDOUT_LIMIT,
        max_stderr_bytes: WORKFLOW_COMMAND_STDERR_LIMIT,
        max_combined_bytes: WORKFLOW_COMMAND_COMBINED_LIMIT,
        max_processes: WORKFLOW_COMMAND_PROCESS_LIMIT,
        max_memory_bytes: WORKFLOW_COMMAND_MEMORY_LIMIT,
    };
    let error = run_workflow_command(&broker, &capability, request)
        .await
        .expect_err("mismatched delivery must reject before broker");
    assert!(matches!(
        error,
        WorkflowIsolationError::RequestIdentityMismatch
    ));
    assert_eq!(broker.command_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn common_boundary_rejects_cwd_outside_attested_roots_before_adapter_call() {
    let attested_identity = identity("run-path-denied");
    let broker = RecordingBroker {
        identity: attested_identity.clone(),
        cancelled_groups: AtomicUsize::new(0),
        command_calls: AtomicUsize::new(0),
        revoked: AtomicBool::new(false),
        output_bytes: 0,
    };
    let capability =
        attest_workflow_isolation(&broker, &attested_identity, &test_isolation_policy())
            .expect("attest");
    let request = WorkflowCommandRequest {
        identity: WorkflowProcessIdentity::new(
            attested_identity,
            WorkflowProcessSubject::Step {
                step_key: "root::node::-::step".to_string(),
                attempt: 1,
                kind: WorkflowCommandKind::Shell,
                root: PathBuf::from("/tmp"),
            },
        ),
        program: "/bin/true".into(),
        args: Vec::new(),
        cwd: "/".into(),
        env: complete_workflow_operation_env(Vec::new()),
        timeout: Duration::from_secs(1),
        max_stdout_bytes: WORKFLOW_COMMAND_STDOUT_LIMIT,
        max_stderr_bytes: WORKFLOW_COMMAND_STDERR_LIMIT,
        max_combined_bytes: WORKFLOW_COMMAND_COMBINED_LIMIT,
        max_processes: WORKFLOW_COMMAND_PROCESS_LIMIT,
        max_memory_bytes: WORKFLOW_COMMAND_MEMORY_LIMIT,
    };
    let error = run_workflow_command(&broker, &capability, request)
        .await
        .expect_err("unattested cwd must reject before broker");
    assert!(matches!(error, WorkflowIsolationError::RequestPathDenied));
    assert_eq!(broker.command_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn command_subject_denies_unlisted_executable_before_broker_call() {
    let attested_identity = identity("run-operation-denied");
    let broker = RecordingBroker {
        identity: attested_identity.clone(),
        cancelled_groups: AtomicUsize::new(0),
        command_calls: AtomicUsize::new(0),
        revoked: AtomicBool::new(false),
        output_bytes: 0,
    };
    let capability =
        attest_workflow_isolation(&broker, &attested_identity, &test_isolation_policy())
            .expect("attest");
    let request = WorkflowCommandRequest {
        identity: WorkflowProcessIdentity::try_step(
            attested_identity,
            "root::node::-::step",
            1,
            WorkflowCommandKind::Shell,
            "/tmp",
        )
        .expect("identity"),
        program: "/usr/bin/git".into(),
        args: vec!["status".to_string()],
        cwd: "/tmp".into(),
        env: complete_workflow_operation_env(Vec::new()),
        timeout: Duration::from_secs(1),
        max_stdout_bytes: WORKFLOW_COMMAND_STDOUT_LIMIT,
        max_stderr_bytes: WORKFLOW_COMMAND_STDERR_LIMIT,
        max_combined_bytes: WORKFLOW_COMMAND_COMBINED_LIMIT,
        max_processes: WORKFLOW_COMMAND_PROCESS_LIMIT,
        max_memory_bytes: WORKFLOW_COMMAND_MEMORY_LIMIT,
    };
    assert!(matches!(
        run_workflow_command(&broker, &capability, request).await,
        Err(WorkflowIsolationError::OperationDenied)
    ));
    assert_eq!(broker.command_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn broker_output_overflow_is_rejected() {
    let attested_identity = identity("run-output-overflow");
    let broker = RecordingBroker {
        identity: attested_identity.clone(),
        cancelled_groups: AtomicUsize::new(0),
        command_calls: AtomicUsize::new(0),
        revoked: AtomicBool::new(false),
        output_bytes: WORKFLOW_COMMAND_STDOUT_LIMIT + 1,
    };
    let capability =
        attest_workflow_isolation(&broker, &attested_identity, &test_isolation_policy())
            .expect("attest");
    let request = WorkflowCommandRequest {
        identity: WorkflowProcessIdentity::try_step(
            attested_identity,
            "root::node::-::step",
            1,
            WorkflowCommandKind::Shell,
            "/tmp",
        )
        .expect("identity"),
        program: "/bin/sh".into(),
        args: vec!["-lc".to_string(), "printf x".to_string()],
        cwd: "/tmp".into(),
        env: complete_workflow_operation_env(Vec::new()),
        timeout: Duration::from_secs(1),
        max_stdout_bytes: WORKFLOW_COMMAND_STDOUT_LIMIT,
        max_stderr_bytes: WORKFLOW_COMMAND_STDERR_LIMIT,
        max_combined_bytes: WORKFLOW_COMMAND_COMBINED_LIMIT,
        max_processes: WORKFLOW_COMMAND_PROCESS_LIMIT,
        max_memory_bytes: WORKFLOW_COMMAND_MEMORY_LIMIT,
    };
    assert!(matches!(
        run_workflow_command(&broker, &capability, request).await,
        Err(WorkflowIsolationError::OutputLimitExceeded)
    ));
    assert_eq!(broker.command_calls.load(Ordering::SeqCst), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn unavailable_materialization_never_executes_repo_hook_in_control_principal() {
    use std::os::unix::fs::PermissionsExt;

    let root = std::env::temp_dir().join(format!(
        "workflow-materialization-hook-{}",
        uuid::Uuid::new_v4()
    ));
    let source = root.join("source");
    let target = root.join("target");
    let canary = root.join("control-principal-hook-canary");
    std::fs::create_dir_all(source.join(".git/hooks")).expect("repo hook directory");
    let hook = source.join(".git/hooks/post-checkout");
    std::fs::write(
        &hook,
        format!("#!/bin/sh\nprintf hook-ran > '{}'\n", canary.display()),
    )
    .expect("hook");
    let mut permissions = std::fs::metadata(&hook)
        .expect("hook metadata")
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&hook, permissions).expect("executable hook");

    let policy = WorkflowIsolationPolicy::try_new(
        [PathBuf::from("/var/empty/anyharness-runtime-private")],
        ["http://127.0.0.1:8457".to_string()],
        [source.clone()],
        [target.clone()],
    )
    .expect("materialization policy");
    let delivery = identity("run-materialization");
    let attestation = WorkflowIsolationAttestation::new(
        "materialization-capability-secret",
        delivery.clone(),
        "test-backend-v1",
        policy.version(),
        1,
        policy.digest(),
        WorkflowIsolationEnforcement::PlatformSandbox,
        guarantees(),
    )
    .expect("attestation");
    let capability = WorkflowIsolationCapability {
        attestation,
        policy,
    };
    let request = WorkflowWorktreeMaterializationRequest {
        identity: WorkflowProcessIdentity::try_materialization(
            delivery,
            "run-level",
            &source,
            &target,
        )
        .expect("materialization identity"),
        source_root: source,
        target_root: target.clone(),
        branch: "workflow-run/run-materialization".to_string(),
        base_commit_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        env: complete_workflow_operation_env(Vec::new()),
    };
    let error =
        materialize_workflow_worktree(&UnavailableWorkflowIsolationBroker, &capability, request)
            .await
            .expect_err("Phase-A has no materialization adapter");
    assert!(matches!(error.cause, WorkflowIsolationError::Unavailable));
    assert!(
        !target.exists(),
        "control principal materialized a worktree"
    );
    assert!(!canary.exists(), "repo hook executed in control principal");
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn terminal_cancel_revokes_stale_local_broker_capability() {
    let delivery = identity("run-1");
    let broker = RecordingBroker {
        identity: delivery.clone(),
        cancelled_groups: AtomicUsize::new(0),
        command_calls: AtomicUsize::new(0),
        revoked: AtomicBool::new(false),
        output_bytes: 0,
    };
    let capability =
        attest_workflow_isolation(&broker, &delivery, &test_isolation_policy()).expect("attest");
    let process_identity = WorkflowProcessIdentity::new(
        delivery,
        WorkflowProcessSubject::Session {
            slot_id: "main".to_string(),
            session_id: "session-1".to_string(),
            root: PathBuf::from("/tmp"),
        },
    );
    assert!(bind_workflow_local_gateway(&broker, &capability, &process_identity).is_ok());
    broker.cancel_run(&capability).await.expect("revoke run");
    assert!(matches!(
        bind_workflow_local_gateway(&broker, &capability, &process_identity),
        Err(WorkflowIsolationError::Cancelled)
    ));
}
