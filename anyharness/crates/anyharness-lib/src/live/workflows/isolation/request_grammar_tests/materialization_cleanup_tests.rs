use super::*;

fn materialization_request(
    delivery: WorkflowDeliveryIdentity,
    source: &std::path::Path,
    target: &std::path::Path,
) -> WorkflowWorktreeMaterializationRequest {
    WorkflowWorktreeMaterializationRequest {
        identity: WorkflowProcessIdentity::try_materialization(delivery, "lane-a", source, target)
            .expect("materialization identity"),
        source_root: source.to_path_buf(),
        target_root: target.to_path_buf(),
        branch: "workflow-run/materialization-error/lane-a".to_string(),
        base_commit_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        env: complete_workflow_operation_env(Vec::new()),
    }
}

fn cleanup_request(
    identity: WorkflowProcessIdentity,
    source: &std::path::Path,
    target: &std::path::Path,
) -> WorkflowWorktreeCleanupRequest {
    WorkflowWorktreeCleanupRequest {
        identity,
        source_root: source.to_path_buf(),
        target_root: target.to_path_buf(),
        branch: "workflow-run/materialization-error/lane-a".to_string(),
        base_commit_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
    }
}

#[tokio::test]
async fn cleanup_rejects_foreign_or_non_materialization_identity_before_broker_call() {
    let source = std::env::temp_dir();
    let target = source.join(format!(
        "workflow-cleanup-identity-boundary-{}",
        uuid::Uuid::new_v4()
    ));
    let accepted_delivery = delivery("run-cleanup-accepted");
    let policy = policy([source.clone()], [target.clone()]);
    let broker = BoundaryBroker::default();
    broker.cleanup_succeeds.store(true, Ordering::SeqCst);
    let capability = capability(&broker, &accepted_delivery, &policy);
    let foreign = WorkflowProcessIdentity::try_materialization(
        delivery("run-cleanup-foreign"),
        "lane-a",
        &source,
        &target,
    )
    .expect("foreign identity");
    assert!(matches!(
        cleanup_workflow_materialization(
            &broker,
            &capability,
            cleanup_request(foreign, &source, &target),
        )
        .await,
        Err(WorkflowIsolationError::RequestIdentityMismatch)
    ));

    let session = WorkflowProcessIdentity::try_session(
        accepted_delivery,
        "main",
        "session-cleanup-boundary",
        &source,
    )
    .expect("session identity");
    assert!(matches!(
        cleanup_workflow_materialization(
            &broker,
            &capability,
            cleanup_request(session, &source, &target),
        )
        .await,
        Err(WorkflowIsolationError::RequestIdentityMismatch)
    ));
    assert_eq!(broker.cleanup_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn adapter_error_after_artifact_creation_is_compensated_by_operation_identity() {
    let base = std::env::temp_dir().join(format!(
        "workflow-materialize-error-cleanup-{}",
        uuid::Uuid::new_v4()
    ));
    let source = base.join("source");
    let target = base.join("target");
    std::fs::create_dir_all(&source).expect("source");
    let delivery = delivery("run-materialization-error-cleanup");
    let policy = policy([source.clone()], [target.clone()]);
    let broker = BoundaryBroker::default();
    broker
        .materialization_error_after_create
        .store(true, Ordering::SeqCst);
    broker.cleanup_succeeds.store(true, Ordering::SeqCst);
    let capability = capability(&broker, &delivery, &policy);

    assert!(matches!(
        materialize_workflow_worktree(
            &broker,
            &capability,
            materialization_request(delivery, &source, &target),
        )
        .await,
        Err(error)
            if matches!(error.cause, WorkflowIsolationError::CommandFailed)
                && error.cleanup_receipt.is_some()
    ));
    assert_eq!(broker.cleanup_calls.load(Ordering::SeqCst), 1);
    assert!(!target.exists(), "operation artifacts must be absent");
    let _ = std::fs::remove_dir_all(base);
}

#[tokio::test]
async fn adapter_error_with_failed_or_stalled_cleanup_is_cleanup_required() {
    for stalled in [false, true] {
        let base = std::env::temp_dir().join(format!(
            "workflow-materialize-error-fenced-{}",
            uuid::Uuid::new_v4()
        ));
        let source = base.join("source");
        let target = base.join("target");
        std::fs::create_dir_all(&source).expect("source");
        let run_id = if stalled {
            "run-materialization-cleanup-stalled"
        } else {
            "run-materialization-cleanup-failed"
        };
        let delivery = delivery(run_id);
        let policy = policy([source.clone()], [target.clone()]);
        let broker = BoundaryBroker::default();
        broker
            .materialization_error_after_create
            .store(true, Ordering::SeqCst);
        broker
            .cleanup_never_returns
            .store(stalled, Ordering::SeqCst);
        let capability = capability(&broker, &delivery, &policy);

        assert!(matches!(
            materialize_workflow_worktree(
                &broker,
                &capability,
                materialization_request(delivery, &source, &target),
            )
            .await,
            Err(error)
                if matches!(error.cause, WorkflowIsolationError::CleanupRequired)
                    && error.cleanup_receipt.is_none()
        ));
        assert_eq!(broker.cleanup_calls.load(Ordering::SeqCst), 1);
        assert!(target.exists(), "ambiguous artifact remains visibly fenced");
        let _ = std::fs::remove_dir_all(base);
    }
}

#[tokio::test]
async fn stalled_cleanup_retains_durable_operation_fence_and_blocks_terminal() {
    let base = std::env::temp_dir().join(format!(
        "workflow-materialize-durable-timeout-{}",
        uuid::Uuid::new_v4()
    ));
    let source = base.join("source");
    let target = base.join("target");
    std::fs::create_dir_all(&source).expect("source");
    let db = crate::persistence::Db::open_in_memory().expect("database");
    crate::app::test_support::seed_workspace_with_repo_root(
        &db,
        "workspace-timeout",
        "local",
        &source.to_string_lossy(),
    );
    let service = crate::domains::workflows::service::WorkflowService::new(
        crate::domains::workflows::store::WorkflowStore::new(db.clone()),
    );
    let run_id = "run-materialization-durable-timeout";
    service
        .create_run_idempotent(
            &format!(r#"{{"run_id":"{run_id}","steps":[]}}"#),
            "workspace-timeout",
        )
        .expect("create run");
    let delivery = delivery(run_id);
    let policy = policy([source.clone()], [target.clone()]);
    let broker = BoundaryBroker::default();
    broker
        .materialization_error_after_create
        .store(true, Ordering::SeqCst);
    broker.cleanup_never_returns.store(true, Ordering::SeqCst);
    let capability = capability(&broker, &delivery, &policy);
    let intent = crate::domains::workflows::cleanup::WorkflowMaterializationIntent {
        run_id: run_id.to_string(),
        scope_id: "lane-a".to_string(),
        source_repo_root_id: "repo-root-workspace-timeout".to_string(),
        source_root: source.clone(),
        target_root: target.clone(),
        branch_name: "workflow-run/materialization-error/lane-a".to_string(),
        base_commit_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        execution_generation: capability.identity().execution_generation(),
        broker_generation: capability.broker_generation(),
    };
    service
        .begin_materialization(&intent)
        .expect("durable begin");

    let error = materialize_workflow_worktree(
        &broker,
        &capability,
        materialization_request(delivery, &source, &target),
    )
    .await
    .expect_err("cleanup timeout must fail closed");
    assert!(matches!(
        error.cause,
        WorkflowIsolationError::CleanupRequired
    ));
    assert!(error.cleanup_receipt.is_none());
    service
        .mark_materialization_cleanup_required(&intent, "broker cleanup timed out")
        .expect("retain durable cleanup fence");
    assert!(service
        .mark_run_terminal(
            run_id,
            anyharness_contract::v1::WorkflowRunStatus::Failed,
            None,
            None,
        )
        .is_err());
    let unresolved = service
        .list_unresolved_materializations(run_id)
        .expect("list unresolved");
    assert_eq!(unresolved.len(), 1);
    assert_eq!(
        unresolved[0].state,
        crate::domains::workflows::cleanup::WorkflowMaterializationState::CleanupRequired
    );
    let _ = std::fs::remove_dir_all(base);
}

#[tokio::test]
async fn mismatched_materialization_output_requires_broker_cleanup_proof() {
    let base = std::env::temp_dir().join(format!(
        "workflow-materialize-cleanup-{}",
        uuid::Uuid::new_v4()
    ));
    let source = base.join("source");
    let target = base.join("target");
    std::fs::create_dir_all(&source).expect("source");
    std::fs::create_dir_all(&target).expect("simulated partial target");
    std::fs::write(target.join("partial"), b"artifact").expect("partial artifact");

    let delivery = delivery("run-materialization-cleanup");
    let policy = policy([source.clone()], [target.clone()]);
    let broker = BoundaryBroker::default();
    broker.cleanup_succeeds.store(true, Ordering::SeqCst);
    let capability = capability(&broker, &delivery, &policy);
    let identity =
        WorkflowProcessIdentity::try_materialization(delivery, "lane-a", &source, &target)
            .expect("materialization identity");
    let branch = "workflow-run/materialization-cleanup/lane-a".to_string();
    let oid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string();
    *broker.materialization_output.lock().unwrap() = Some(WorkflowWorktreeMaterializationOutput {
        canonical_source_root: source.clone(),
        canonical_target_root: target.join("wrong-echo"),
        branch: branch.clone(),
        base_commit_oid: oid.clone(),
        head_oid: oid.clone(),
        execution_generation: capability.identity().execution_generation(),
        broker_generation: capability.broker_generation(),
    });
    let request = WorkflowWorktreeMaterializationRequest {
        identity,
        source_root: source,
        target_root: target.clone(),
        branch,
        base_commit_oid: oid,
        env: complete_workflow_operation_env(Vec::new()),
    };

    assert!(matches!(
        materialize_workflow_worktree(&broker, &capability, request).await,
        Err(error)
            if matches!(error.cause, WorkflowIsolationError::RequestPathDenied)
                && error.cleanup_receipt.is_some()
    ));
    assert_eq!(broker.cleanup_calls.load(Ordering::SeqCst), 1);
    assert!(
        !target.exists(),
        "cleanup receipt must correspond to absence"
    );
    let _ = std::fs::remove_dir_all(base);
}

#[tokio::test]
async fn failed_materialization_compensation_returns_cleanup_required() {
    let base = std::env::temp_dir().join(format!(
        "workflow-materialize-cleanup-fail-{}",
        uuid::Uuid::new_v4()
    ));
    let source = base.join("source");
    let target = base.join("target");
    std::fs::create_dir_all(&source).expect("source");
    std::fs::create_dir_all(&target).expect("simulated partial target");

    let delivery = delivery("run-materialization-cleanup-fail");
    let policy = policy([source.clone()], [target.clone()]);
    let broker = BoundaryBroker::default();
    let capability = capability(&broker, &delivery, &policy);
    let identity =
        WorkflowProcessIdentity::try_materialization(delivery, "lane-a", &source, &target)
            .expect("materialization identity");
    let branch = "workflow-run/materialization-cleanup-fail/lane-a".to_string();
    let oid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string();
    *broker.materialization_output.lock().unwrap() = Some(WorkflowWorktreeMaterializationOutput {
        canonical_source_root: source.clone(),
        canonical_target_root: target.join("wrong-echo"),
        branch: branch.clone(),
        base_commit_oid: oid.clone(),
        head_oid: oid.clone(),
        execution_generation: capability.identity().execution_generation(),
        broker_generation: capability.broker_generation(),
    });
    let request = WorkflowWorktreeMaterializationRequest {
        identity,
        source_root: source,
        target_root: target.clone(),
        branch,
        base_commit_oid: oid,
        env: complete_workflow_operation_env(Vec::new()),
    };

    assert!(matches!(
        materialize_workflow_worktree(&broker, &capability, request).await,
        Err(error)
            if matches!(error.cause, WorkflowIsolationError::CleanupRequired)
                && error.cleanup_receipt.is_none()
    ));
    assert_eq!(broker.cleanup_calls.load(Ordering::SeqCst), 1);
    assert!(
        target.exists(),
        "failed cleanup keeps the artifact visibly fenced"
    );
    let _ = std::fs::remove_dir_all(base);
}
