use super::*;
use crate::process_env::{
    complete_workflow_operation_env, poisoned_workflow_agent_env, poisoned_workflow_operation_env,
    test_scoped_workflow_agent_env,
};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

mod materialization_cleanup_tests;

#[derive(Default)]
struct BoundaryBroker {
    agent_calls: AtomicUsize,
    command_calls: AtomicUsize,
    materialization_calls: AtomicUsize,
    materialization_output: Mutex<Option<WorkflowWorktreeMaterializationOutput>>,
    materialization_error_after_create: AtomicBool,
    cleanup_calls: AtomicUsize,
    cleanup_succeeds: AtomicBool,
    cleanup_never_returns: AtomicBool,
    cancelled_groups: AtomicUsize,
    cancelled_runs: AtomicUsize,
}

#[async_trait::async_trait]
impl WorkflowIsolationBroker for BoundaryBroker {
    fn attest(
        &self,
        identity: &WorkflowDeliveryIdentity,
        policy: &WorkflowIsolationPolicy,
    ) -> Result<WorkflowIsolationAttestation, WorkflowIsolationError> {
        WorkflowIsolationAttestation::new(
            "boundary-capability",
            identity.clone(),
            "boundary-broker-v1",
            policy.version(),
            1,
            policy.digest(),
            WorkflowIsolationEnforcement::PlatformSandbox,
            REQUIRED_GUARANTEES,
        )
    }

    fn spawn_agent(
        &self,
        _capability: &WorkflowIsolationCapability,
        _request: WorkflowAgentLaunchRequest,
    ) -> Result<BrokeredWorkflowAgentProcess, WorkflowIsolationError> {
        self.agent_calls.fetch_add(1, Ordering::SeqCst);
        Err(WorkflowIsolationError::LaunchFailed)
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
        _capability: &WorkflowIsolationCapability,
        _identity: &WorkflowProcessIdentity,
    ) -> Result<TrustedLocalGatewayBinding, WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    async fn run_command(
        &self,
        _capability: &WorkflowIsolationCapability,
        _request: WorkflowCommandRequest,
    ) -> Result<WorkflowCommandOutput, WorkflowIsolationError> {
        self.command_calls.fetch_add(1, Ordering::SeqCst);
        Err(WorkflowIsolationError::CommandFailed)
    }

    async fn materialize_worktree(
        &self,
        _capability: &WorkflowIsolationCapability,
        request: WorkflowWorktreeMaterializationRequest,
    ) -> Result<WorkflowWorktreeMaterializationOutput, WorkflowIsolationError> {
        self.materialization_calls.fetch_add(1, Ordering::SeqCst);
        if self
            .materialization_error_after_create
            .load(Ordering::SeqCst)
        {
            std::fs::create_dir_all(&request.target_root)
                .map_err(|_| WorkflowIsolationError::CommandFailed)?;
            std::fs::write(request.target_root.join("partial"), b"artifact")
                .map_err(|_| WorkflowIsolationError::CommandFailed)?;
            return Err(WorkflowIsolationError::CommandFailed);
        }
        self.materialization_output
            .lock()
            .unwrap()
            .clone()
            .ok_or(WorkflowIsolationError::Unavailable)
    }

    async fn cleanup_materialization(
        &self,
        capability: &WorkflowIsolationCapability,
        request: WorkflowWorktreeCleanupRequest,
    ) -> Result<WorkflowWorktreeCleanupOutput, WorkflowIsolationError> {
        self.cleanup_calls.fetch_add(1, Ordering::SeqCst);
        if self.cleanup_never_returns.load(Ordering::SeqCst) {
            return std::future::pending().await;
        }
        if !self.cleanup_succeeds.load(Ordering::SeqCst) {
            return Err(WorkflowIsolationError::Unavailable);
        }
        let (source_root, target_root) = match request.identity.subject() {
            WorkflowProcessSubject::Materialization {
                source_root,
                target_root,
                ..
            } => (source_root.clone(), target_root.clone()),
            _ => return Err(WorkflowIsolationError::RequestIdentityMismatch),
        };
        if target_root.exists() {
            std::fs::remove_dir_all(&target_root)
                .map_err(|_| WorkflowIsolationError::CleanupRequired)?;
        }
        Ok(WorkflowWorktreeCleanupOutput {
            identity: request.identity,
            canonical_source_root: source_root,
            canonical_target_root: target_root.clone(),
            branch: request.branch,
            base_commit_oid: request.base_commit_oid,
            checkout_absent: !target_root.exists(),
            branch_ref_absent: true,
            all_operation_artifacts_absent: !target_root.exists(),
            execution_generation: capability.identity().execution_generation(),
            broker_generation: capability.broker_generation(),
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
        self.cancelled_runs.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn notify_step_transition(
        &self,
        _capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowIsolationError> {
        Ok(())
    }
}

fn delivery(run_id: &str) -> WorkflowDeliveryIdentity {
    WorkflowDeliveryIdentity::try_new(
        run_id,
        Some("sha256:1111111111111111111111111111111111111111111111111111111111111111"),
        Some("sha256:2222222222222222222222222222222222222222222222222222222222222222"),
        Some(7),
    )
    .expect("delivery identity")
}

fn capability(
    broker: &BoundaryBroker,
    delivery: &WorkflowDeliveryIdentity,
    policy: &WorkflowIsolationPolicy,
) -> WorkflowIsolationCapability {
    attest_workflow_isolation(broker, delivery, policy).expect("attested capability")
}

fn policy(
    roots: impl IntoIterator<Item = PathBuf>,
    materialization_roots: impl IntoIterator<Item = PathBuf>,
) -> WorkflowIsolationPolicy {
    WorkflowIsolationPolicy::try_new(
        [PathBuf::from("/var/empty/anyharness-runtime-private")],
        ["http://127.0.0.1:8457".to_string()],
        roots,
        materialization_roots,
    )
    .expect("isolation policy")
}

fn agent_request(
    delivery: WorkflowDeliveryIdentity,
    root: &std::path::Path,
) -> WorkflowAgentLaunchRequest {
    WorkflowAgentLaunchRequest {
        identity: WorkflowProcessIdentity::try_session(delivery, "main", "session-1", root)
            .expect("session identity"),
        program: PathBuf::from("/usr/bin/true"),
        args: Vec::new(),
        cwd: root.to_path_buf(),
        env: test_scoped_workflow_agent_env(
            "claude",
            [(
                "ANTHROPIC_AUTH_TOKEN".to_string(),
                "scoped-test".to_string(),
            )],
        ),
        resources: WorkflowAgentResourceLimits::phase_a_maximums(),
    }
}

fn command_request(
    delivery: WorkflowDeliveryIdentity,
    root: &std::path::Path,
) -> WorkflowCommandRequest {
    WorkflowCommandRequest {
        identity: WorkflowProcessIdentity::try_step(
            delivery,
            "root::step",
            1,
            WorkflowCommandKind::Shell,
            root,
        )
        .expect("step identity"),
        program: PathBuf::from("/bin/sh"),
        args: vec!["-lc".to_string(), "true".to_string()],
        cwd: root.to_path_buf(),
        env: complete_workflow_operation_env([("LANG".to_string(), "C".to_string())]),
        timeout: Duration::from_secs(1),
        max_stdout_bytes: WORKFLOW_COMMAND_STDOUT_LIMIT,
        max_stderr_bytes: WORKFLOW_COMMAND_STDERR_LIMIT,
        max_combined_bytes: WORKFLOW_COMMAND_COMBINED_LIMIT,
        max_processes: WORKFLOW_COMMAND_PROCESS_LIMIT,
        max_memory_bytes: WORKFLOW_COMMAND_MEMORY_LIMIT,
    }
}

#[tokio::test]
async fn agent_boundary_rejects_resource_and_grammar_abuse_before_broker_spawn() {
    let broker = BoundaryBroker::default();
    let delivery = delivery("run-agent-grammar");
    let root = std::env::temp_dir();
    let policy = policy([root.clone()], Vec::new());
    let capability = capability(&broker, &delivery, &policy);

    let mut excessive_resources = agent_request(delivery.clone(), &root);
    excessive_resources.resources.max_processes = WORKFLOW_AGENT_PROCESS_LIMIT + 1;
    assert!(matches!(
        spawn_workflow_agent(&broker, &capability, excessive_resources).await,
        Err(WorkflowIsolationError::InvalidResourceLimits)
    ));

    let mut duplicate_env = agent_request(delivery.clone(), &root);
    duplicate_env.env = poisoned_workflow_agent_env(
        "claude",
        [
            ("TOKEN".to_string(), "one".to_string()),
            ("TOKEN".to_string(), "two".to_string()),
        ],
    );
    assert!(matches!(
        spawn_workflow_agent(&broker, &capability, duplicate_env).await,
        Err(WorkflowIsolationError::InvalidRequestGrammar)
    ));

    let mut ambient_secret = agent_request(delivery.clone(), &root);
    ambient_secret.env = poisoned_workflow_agent_env(
        "claude",
        [("AWS_SECRET_ACCESS_KEY".to_string(), "canary".to_string())],
    );
    assert!(matches!(
        spawn_workflow_agent(&broker, &capability, ambient_secret).await,
        Err(WorkflowIsolationError::InvalidRequestGrammar)
    ));

    let mut nul_arg = agent_request(delivery.clone(), &root);
    nul_arg.args = vec!["--model\0forged".to_string()];
    assert!(matches!(
        spawn_workflow_agent(&broker, &capability, nul_arg).await,
        Err(WorkflowIsolationError::InvalidRequestGrammar)
    ));

    let mut too_many_args = agent_request(delivery, &root);
    too_many_args.args = vec!["x".to_string(); 257];
    assert!(matches!(
        spawn_workflow_agent(&broker, &capability, too_many_args).await,
        Err(WorkflowIsolationError::InvalidRequestGrammar)
    ));
    assert_eq!(broker.agent_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn command_boundary_rejects_resource_and_grammar_abuse_before_broker_call() {
    let broker = BoundaryBroker::default();
    let delivery = delivery("run-command-grammar");
    let root = std::env::temp_dir();
    let policy = policy([root.clone()], Vec::new());
    let capability = capability(&broker, &delivery, &policy);

    let mut duplicate_env = command_request(delivery.clone(), &root);
    duplicate_env.env = poisoned_workflow_operation_env([
        ("LANG".to_string(), "C".to_string()),
        ("LANG".to_string(), "forged".to_string()),
    ]);
    assert!(matches!(
        run_workflow_command(&broker, &capability, duplicate_env).await,
        Err(WorkflowIsolationError::InvalidRequestGrammar)
    ));

    let mut ambient_secret = command_request(delivery.clone(), &root);
    ambient_secret.env = poisoned_workflow_operation_env([(
        "AWS_SECRET_ACCESS_KEY".to_string(),
        "canary".to_string(),
    )]);
    assert!(matches!(
        run_workflow_command(&broker, &capability, ambient_secret).await,
        Err(WorkflowIsolationError::InvalidRequestGrammar)
    ));

    let mut nul_arg = command_request(delivery.clone(), &root);
    nul_arg.args[1].push('\0');
    assert!(matches!(
        run_workflow_command(&broker, &capability, nul_arg).await,
        Err(WorkflowIsolationError::InvalidRequestGrammar)
    ));

    let mut too_many_args = command_request(delivery.clone(), &root);
    too_many_args.args = vec!["x".to_string(); 257];
    assert!(matches!(
        run_workflow_command(&broker, &capability, too_many_args).await,
        Err(WorkflowIsolationError::InvalidRequestGrammar)
    ));

    let mut excessive_resources = command_request(delivery, &root);
    excessive_resources.max_memory_bytes = WORKFLOW_COMMAND_MEMORY_LIMIT + 1;
    assert!(matches!(
        run_workflow_command(&broker, &capability, excessive_resources).await,
        Err(WorkflowIsolationError::InvalidResourceLimits)
    ));
    assert_eq!(broker.command_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn process_identity_prevents_cross_lane_cwd_reuse() {
    let broker = BoundaryBroker::default();
    let delivery = delivery("run-cross-lane");
    let base = std::env::temp_dir().join(format!("workflow-lanes-{}", uuid::Uuid::new_v4()));
    let lane_a = base.join("lane-a");
    let lane_b = base.join("lane-b");
    let policy = policy([lane_a.clone(), lane_b.clone()], Vec::new());
    let capability = capability(&broker, &delivery, &policy);
    let mut request = command_request(delivery, &lane_a);
    request.cwd = lane_b;

    assert!(matches!(
        run_workflow_command(&broker, &capability, request).await,
        Err(WorkflowIsolationError::RequestPathDenied)
    ));
    assert_eq!(broker.command_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn remote_scm_push_and_pr_are_denied_before_broker_call() {
    let broker = BoundaryBroker::default();
    let delivery = delivery("run-scm-effect-parked");
    let root = std::env::temp_dir();
    let policy = policy([root.clone()], Vec::new());
    let capability = capability(&broker, &delivery, &policy);
    for (program, args) in [
        (PathBuf::from("git"), vec!["push", "-u", "origin", "HEAD"]),
        (
            PathBuf::from("gh"),
            vec!["pr", "create", "--title", "title", "--body", "body"],
        ),
    ] {
        let request = WorkflowCommandRequest {
            identity: WorkflowProcessIdentity::try_step(
                delivery.clone(),
                "root::scm",
                1,
                WorkflowCommandKind::Scm,
                &root,
            )
            .expect("SCM identity"),
            program,
            args: args.into_iter().map(str::to_string).collect(),
            cwd: root.clone(),
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
    }
    assert_eq!(broker.command_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn generic_git_lane_merge_is_denied_before_hooks_or_config_can_run() {
    let broker = BoundaryBroker::default();
    let delivery = delivery("run-lane-merge-parked");
    let root = std::env::temp_dir();
    let policy = policy([root.clone()], Vec::new());
    let capability = capability(&broker, &delivery, &policy);
    let request = WorkflowCommandRequest {
        identity: WorkflowProcessIdentity::try_lane_merge(delivery, "lane-a", &root)
            .expect("lane identity"),
        program: PathBuf::from("/usr/bin/git"),
        args: vec![
            "merge".to_string(),
            "--no-ff".to_string(),
            "--no-edit".to_string(),
            "workflow-run/lane-a".to_string(),
        ],
        cwd: root,
        env: complete_workflow_operation_env(Vec::new()),
        timeout: Duration::from_secs(60),
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
async fn materialization_boundary_rejects_env_and_ref_grammar_before_broker_call() {
    let broker = BoundaryBroker::default();
    let delivery = delivery("run-materialization-grammar");
    let base = std::env::temp_dir().join(format!("workflow-materialize-{}", uuid::Uuid::new_v4()));
    let source = base.join("source");
    let target = base.join("target");
    let policy = policy([source.clone()], [target.clone()]);
    let capability = capability(&broker, &delivery, &policy);
    let request = WorkflowWorktreeMaterializationRequest {
        identity: WorkflowProcessIdentity::try_materialization(
            delivery, "lane-a", &source, &target,
        )
        .expect("materialization identity"),
        source_root: source,
        target_root: target,
        branch: "workflow-run/run-materialization/lane-a".to_string(),
        base_commit_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        env: complete_workflow_operation_env([("LANG".to_string(), "C".to_string())]),
    };

    let mut duplicate_env = request.clone();
    duplicate_env.env = poisoned_workflow_operation_env([
        ("LANG".to_string(), "C".to_string()),
        ("LANG".to_string(), "forged".to_string()),
    ]);
    assert!(matches!(
        materialize_workflow_worktree(&broker, &capability, duplicate_env).await,
        Err(error) if matches!(error.cause, WorkflowIsolationError::InvalidRequestGrammar)
    ));

    let mut nul_env = request.clone();
    nul_env.env = poisoned_workflow_operation_env([("LANG".to_string(), "C\0forged".to_string())]);
    assert!(matches!(
        materialize_workflow_worktree(&broker, &capability, nul_env).await,
        Err(error) if matches!(error.cause, WorkflowIsolationError::InvalidRequestGrammar)
    ));

    let mut ambient_secret = request.clone();
    ambient_secret.env = poisoned_workflow_operation_env([(
        "AWS_SECRET_ACCESS_KEY".to_string(),
        "canary".to_string(),
    )]);
    assert!(matches!(
        materialize_workflow_worktree(&broker, &capability, ambient_secret).await,
        Err(error) if matches!(error.cause, WorkflowIsolationError::InvalidRequestGrammar)
    ));

    for invalid_branch in [
        "workflow-run/.hidden".to_string(),
        "workflow-run/ref.lock".to_string(),
        "workflow-run//lane".to_string(),
        "a".repeat(256),
    ] {
        let mut invalid_ref = request.clone();
        invalid_ref.branch = invalid_branch;
        assert!(matches!(
            materialize_workflow_worktree(&broker, &capability, invalid_ref).await,
            Err(error) if matches!(error.cause, WorkflowIsolationError::RequestPathDenied)
        ));
    }
    assert_eq!(broker.materialization_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn mismatched_process_group_revokes_the_run_instead_of_signalling_the_group() {
    let broker = Arc::new(BoundaryBroker::default());
    let run_delivery = delivery("run-process-group");
    let root = std::env::temp_dir();
    let policy = policy([root.clone()], Vec::new());
    let capability = capability(broker.as_ref(), &run_delivery, &policy);
    let identity = WorkflowProcessIdentity::try_session(run_delivery, "main", "session-1", root)
        .expect("session identity");
    let mismatched = WorkflowProcessGroup::try_new(
        "group-from-stale-broker",
        identity,
        capability.identity().execution_generation(),
        capability.broker_generation() + 1,
    )
    .expect("well-formed but stale process group");

    drop(WorkflowProcessGroupGuard::new(
        broker.clone(),
        capability,
        mismatched,
    ));
    for _ in 0..20 {
        if broker.cancelled_runs.load(Ordering::SeqCst) == 1 {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert_eq!(broker.cancelled_groups.load(Ordering::SeqCst), 0);
    assert_eq!(broker.cancelled_runs.load(Ordering::SeqCst), 1);
    assert!(WorkflowProcessGroup::try_new(
        " group-with-whitespace ",
        WorkflowProcessIdentity::try_session(
            delivery("run-invalid-group"),
            "main",
            "session-2",
            std::env::temp_dir(),
        )
        .expect("session identity"),
        7,
        1,
    )
    .is_err());
}
