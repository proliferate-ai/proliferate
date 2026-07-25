use std::sync::Arc;

use anyharness_contract::v1::WorkflowRunStatus;

use super::cleanup::{
    WorkflowMaterializationBegin, WorkflowMaterializationCleanupReceipt,
    WorkflowMaterializationIntent, WorkflowMaterializationState,
};
use super::service::WorkflowService;
use super::store::WorkflowStore;
use super::workspace_ports::WorkflowWorkspaceDeleteParticipant;
use crate::app::test_support;
use crate::domains::sessions::deletion::SessionDeleteWorkflow;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
use crate::domains::workspaces::model::{
    WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
    WorkspaceSurface,
};
use crate::origin::OriginContext;
use crate::persistence::Db;

fn fixture(run_id: &str) -> (Db, WorkflowService) {
    let db = Db::open_in_memory().expect("open cleanup test database");
    test_support::seed_workspace_with_repo_root(
        &db,
        "workspace-1",
        "local",
        "/tmp/workflow-cleanup-test",
    );
    let service = WorkflowService::new(WorkflowStore::new(db.clone()));
    let plan = format!(r#"{{"run_id":"{run_id}","steps":[]}}"#);
    service
        .create_run_idempotent(&plan, "workspace-1")
        .expect("create cleanup test run");
    (db, service)
}

fn intent(run_id: &str, scope_id: &str, broker_generation: u64) -> WorkflowMaterializationIntent {
    let temp = std::fs::canonicalize(std::env::temp_dir()).expect("canonical temp dir");
    WorkflowMaterializationIntent {
        run_id: run_id.to_string(),
        scope_id: scope_id.to_string(),
        source_repo_root_id: "repo-root-workspace-1".to_string(),
        source_root: temp.clone(),
        target_root: temp.join(format!("workflow-cleanup-test-{run_id}-{scope_id}")),
        branch_name: format!("workflow-run/{run_id}/{scope_id}"),
        base_commit_oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        execution_generation: 1,
        broker_generation,
    }
}

fn state(db: &Db, intent: &WorkflowMaterializationIntent) -> String {
    db.with_conn(|conn| {
        conn.query_row(
            "SELECT state FROM workflow_materialization_operations
             WHERE run_id = ?1 AND scope_id = ?2
               AND execution_generation = ?3 AND broker_generation = ?4",
            rusqlite::params![
                intent.run_id,
                intent.scope_id,
                intent.execution_generation,
                i64::try_from(intent.broker_generation).expect("test broker generation"),
            ],
            |row| row.get(0),
        )
    })
    .expect("load materialization state")
}

fn cleanup_receipt(
    intent: &WorkflowMaterializationIntent,
) -> WorkflowMaterializationCleanupReceipt {
    WorkflowMaterializationCleanupReceipt::from_validated_broker(
        intent.clone(),
        intent.source_root.clone(),
        intent.target_root.clone(),
        intent.branch_name.clone(),
        intent.base_commit_oid.clone(),
        true,
        true,
        true,
        intent.execution_generation,
        intent.broker_generation,
    )
}

fn materialized_workspace(
    intent: &WorkflowMaterializationIntent,
    workspace_id: &str,
) -> WorkspaceRecord {
    WorkspaceRecord {
        id: workspace_id.to_string(),
        kind: WorkspaceKind::Worktree,
        repo_root_id: intent.source_repo_root_id.clone(),
        path: intent.target_root.to_string_lossy().to_string(),
        surface: WorkspaceSurface::Standard,
        original_branch: Some(intent.base_commit_oid.clone()),
        current_branch: Some(intent.branch_name.clone()),
        display_name: None,
        origin: Some(OriginContext::api_local_runtime()),
        creator_context: Some(WorkspaceCreatorContext::Automation {
            automation_id: None,
            automation_run_id: Some(intent.run_id.clone()),
            label: Some("workflow-run".to_string()),
        }),
        lifecycle_state: WorkspaceLifecycleState::Active,
        cleanup_state: WorkspaceCleanupState::None,
        cleanup_operation: None,
        cleanup_error_message: None,
        cleanup_failed_at: None,
        cleanup_attempted_at: None,
        created_at: "2026-07-11T00:00:00Z".to_string(),
        updated_at: "2026-07-11T00:00:00Z".to_string(),
    }
}

#[test]
fn materialization_state_workspace_coherence_is_database_enforced() {
    let (db, service) = fixture("run-coherence");
    test_support::seed_workspace_with_repo_root(
        &db,
        "workspace-materialized",
        "worktree",
        "/tmp/workflow-materialized",
    );
    let insert = |state: &str, workspace_id: Option<&str>, last_error: Option<&str>| {
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workflow_materialization_operations (
                    run_id, scope_id, source_repo_root_id, source_root, target_root, branch_name,
                    base_commit_oid, execution_generation, broker_generation,
                    state, workspace_id, last_error, created_at, updated_at
                 ) VALUES (
                    'run-coherence', ?1, 'repo-root-workspace-1', '/tmp/source', '/tmp/target',
                    'workflow-run/run-coherence/lane',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1, 1,
                    ?2, ?3, ?4, '2026-07-11T00:00:00Z', '2026-07-11T00:00:00Z'
                 )",
                rusqlite::params![
                    format!("scope-{state}-{}", workspace_id.unwrap_or("none")),
                    state,
                    workspace_id,
                    last_error,
                ],
            )
        })
    };

    assert!(insert("registered", None, None).is_err());
    assert!(insert("pending", Some("workspace-materialized"), None).is_err());
    assert!(insert("cleaned", Some("workspace-materialized"), None).is_err());
    assert!(insert("cleanup_required", None, None).is_err());
    assert!(insert("registered", Some("missing-workspace"), None).is_err());

    let immutable = intent("run-coherence", "immutable", 1);
    service
        .begin_materialization(&immutable)
        .expect("begin immutable");
    assert!(db
        .with_conn(|conn| conn.execute(
            "UPDATE workflow_materialization_operations
             SET source_root = '/tmp/mutated-source'
             WHERE run_id = 'run-coherence' AND scope_id = 'immutable'",
            [],
        ))
        .is_err());
}

#[test]
fn cleaned_operation_identity_is_immutable_and_cannot_be_rearmed() {
    let (_db, service) = fixture("run-retired-operation");
    let intent = intent("run-retired-operation", "lane-a", 1);
    assert!(matches!(
        service.begin_materialization(&intent).expect("begin"),
        WorkflowMaterializationBegin::Ready(_)
    ));
    service
        .record_materialization_cleanup_receipt(&cleanup_receipt(&intent))
        .expect("record cleanup receipt");

    assert!(matches!(
        service
            .begin_materialization(&intent)
            .expect("read retired operation"),
        WorkflowMaterializationBegin::Retired(_)
    ));
    assert_eq!(
        service
            .store()
            .list_unresolved_materializations(&intent.run_id)
            .expect("list unresolved")
            .len(),
        0
    );
}

#[test]
fn broker_generation_conversion_is_checked_at_sqlite_boundary() {
    let (db, service) = fixture("run-generation-boundary");
    let maximum = intent("run-generation-boundary", "maximum", i64::MAX as u64);
    assert!(matches!(
        service.begin_materialization(&maximum).expect("i64 max"),
        WorkflowMaterializationBegin::Ready(_)
    ));

    let overflow = intent("run-generation-boundary", "overflow", (i64::MAX as u64) + 1);
    assert!(service.begin_materialization(&overflow).is_err());
    let overflow_rows: i64 = db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM workflow_materialization_operations
                 WHERE run_id = ?1 AND scope_id = 'overflow'",
                [&overflow.run_id],
                |row| row.get(0),
            )
        })
        .expect("count overflow rows");
    assert_eq!(overflow_rows, 0);

    let mut invalid_execution = intent("run-generation-boundary", "negative-execution", 1);
    invalid_execution.execution_generation = 0;
    assert!(service.begin_materialization(&invalid_execution).is_err());
    let zero_broker = intent("run-generation-boundary", "zero-broker", 0);
    assert!(service.begin_materialization(&zero_broker).is_err());
}

#[test]
fn materialization_transition_requires_the_full_immutable_intent() {
    let (db, service) = fixture("run-mutated-intent");
    let original = intent("run-mutated-intent", "lane-a", 1);
    service.begin_materialization(&original).expect("begin");
    let mut mutations = Vec::new();
    let mut mutated = original.clone();
    mutated.source_repo_root_id = "repo-root-attacker".to_string();
    mutations.push(mutated);
    let mut mutated = original.clone();
    mutated.run_id = "run-other".to_string();
    mutations.push(mutated);
    let mut mutated = original.clone();
    mutated.scope_id = "lane-other".to_string();
    mutations.push(mutated);
    let mut mutated = original.clone();
    mutated.execution_generation += 1;
    mutations.push(mutated);
    let mut mutated = original.clone();
    mutated.broker_generation += 1;
    mutations.push(mutated);
    let mut mutated = original.clone();
    mutated.source_root = "/tmp/attacker-source".into();
    mutations.push(mutated);
    let mut mutated = original.clone();
    mutated.target_root = "/tmp/attacker-target".into();
    mutations.push(mutated);
    let mut mutated = original.clone();
    mutated.branch_name = "workflow-run/attacker/lane".to_string();
    mutations.push(mutated);
    let mut mutated = original.clone();
    mutated.base_commit_oid = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string();
    mutations.push(mutated);

    for mutated in mutations {
        assert!(service
            .record_materialization_cleanup_receipt(&cleanup_receipt(&mutated))
            .is_err());
        assert_eq!(state(&db, &original), "pending");
    }
}

#[test]
fn cleanup_receipt_must_prove_every_operation_artifact_absent() {
    let (db, service) = fixture("run-incomplete-cleanup-proof");
    let intent = intent("run-incomplete-cleanup-proof", "lane-a", 1);
    service.begin_materialization(&intent).expect("begin");

    let incomplete = WorkflowMaterializationCleanupReceipt::from_validated_broker(
        intent.clone(),
        intent.source_root.clone(),
        intent.target_root.clone(),
        intent.branch_name.clone(),
        intent.base_commit_oid.clone(),
        true,
        false,
        false,
        intent.execution_generation,
        intent.broker_generation,
    );
    assert!(service
        .record_materialization_cleanup_receipt(&incomplete)
        .is_err());
    assert_eq!(state(&db, &intent), "pending");
}

#[test]
fn unresolved_materialization_and_generic_fence_block_terminal_publication() {
    let (_db, service) = fixture("run-terminal-fence");
    let materialization = intent("run-terminal-fence", "lane-a", 1);
    service
        .begin_materialization(&materialization)
        .expect("begin");
    assert!(service
        .mark_run_terminal(
            "run-terminal-fence",
            WorkflowRunStatus::Completed,
            None,
            None
        )
        .is_err());
    service
        .mark_materialization_cleanup_required(&materialization, "cleanup retry needed")
        .expect("mark cleanup required");
    assert!(service
        .mark_run_terminal(
            "run-terminal-fence",
            WorkflowRunStatus::Completed,
            None,
            None
        )
        .is_err());
    service
        .record_materialization_cleanup_receipt(&cleanup_receipt(&materialization))
        .expect("clean materialization");
    service
        .require_cleanup_fence("run-terminal-fence", "broker", "run", "awaiting receipt")
        .expect("persist generic fence");
    assert!(service
        .mark_run_terminal(
            "run-terminal-fence",
            WorkflowRunStatus::Completed,
            None,
            None
        )
        .is_err());
    service
        .clear_cleanup_fence("run-terminal-fence", "broker", "run")
        .expect("clear fence");
    service
        .mark_run_terminal(
            "run-terminal-fence",
            WorkflowRunStatus::Completed,
            None,
            None,
        )
        .expect("terminal after receipts");
    let late = intent("run-terminal-fence", "late-lane", 1);
    assert!(service.begin_materialization(&late).is_err());
    assert!(service
        .require_cleanup_fence(
            "run-terminal-fence",
            "late-broker",
            "run",
            "must not appear after terminal publication",
        )
        .is_err());
    assert!(service
        .list_cleanup_fences("run-terminal-fence")
        .expect("list terminal fences")
        .is_empty());
}

#[test]
fn restart_converts_pending_operation_to_cleanup_required() {
    let (db, service) = fixture("run-restart-fence");
    let intent = intent("run-restart-fence", "lane-a", 1);
    service.begin_materialization(&intent).expect("begin");
    assert_eq!(
        service
            .fence_pending_materializations_after_restart("run-restart-fence")
            .expect("restart fence"),
        1
    );
    assert_eq!(state(&db, &intent), "cleanup_required");
}

#[test]
fn run_delete_guard_blocks_unresolved_states_and_allows_settled_history() {
    for (suffix, cleanup_required) in [("pending", false), ("required", true)] {
        let run_id = format!("run-delete-{suffix}");
        let (db, service) = fixture(&run_id);
        let intent = intent(&run_id, "lane-a", 1);
        service.begin_materialization(&intent).expect("begin");
        if cleanup_required {
            service
                .mark_materialization_cleanup_required(&intent, "still ambiguous")
                .expect("mark required");
        }
        assert!(
            db.with_conn(
                |conn| conn.execute("DELETE FROM workflow_runs WHERE run_id = ?1", [&run_id])
            )
            .is_err()
        );
        assert!(service.get_run(&run_id).expect("load run").is_some());
    }

    let (db, service) = fixture("run-delete-fence");
    service
        .require_cleanup_fence("run-delete-fence", "broker", "run", "not quiescent")
        .expect("fence");
    assert!(db
        .with_conn(|conn| conn.execute(
            "DELETE FROM workflow_runs WHERE run_id = 'run-delete-fence'",
            [],
        ))
        .is_err());

    let (db, service) = fixture("run-delete-cleaned");
    let cleaned = intent("run-delete-cleaned", "lane-a", 1);
    service.begin_materialization(&cleaned).expect("begin");
    service
        .record_materialization_cleanup_receipt(&cleanup_receipt(&cleaned))
        .expect("cleaned");
    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM workflow_runs WHERE run_id = 'run-delete-cleaned'",
            [],
        )
    })
    .expect("delete settled run");
    assert!(service
        .get_run("run-delete-cleaned")
        .expect("load deleted")
        .is_none());

    let (db, service) = fixture("run-delete-registered");
    let registered = intent("run-delete-registered", "lane-a", 1);
    service.begin_materialization(&registered).expect("begin");
    service
        .register_materialized_workspace(
            &registered,
            &materialized_workspace(&registered, "workspace-owned"),
        )
        .expect("register");
    assert!(db
        .with_conn(|conn| {
            conn.execute(
                "DELETE FROM workflow_runs WHERE run_id = 'run-delete-registered'",
                [],
            )
        })
        .is_err());
    let workspace_remains: bool = db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = 'workspace-owned')",
                [],
                |row| row.get(0),
            )
        })
        .expect("query workspace");
    assert!(workspace_remains);
}

#[test]
fn registered_workspace_delete_requires_exact_cleanup_receipt() {
    let (db, service) = fixture("run-workspace-delete");
    let intent = intent("run-workspace-delete", "lane-a", 1);
    service.begin_materialization(&intent).expect("begin");
    service
        .register_materialized_workspace(
            &intent,
            &materialized_workspace(&intent, "workspace-owned"),
        )
        .expect("register");

    assert!(db
        .with_conn(|conn| conn.execute("DELETE FROM workspaces WHERE id = 'workspace-owned'", [],))
        .is_err());

    let delete_workflow = WorkspaceDeleteWorkflow::with_participants(
        db.clone(),
        SessionDeleteWorkflow::new(db.clone()),
        vec![Arc::new(WorkflowWorkspaceDeleteParticipant)],
    );
    assert!(delete_workflow
        .purge_workspace_with_sessions("workspace-owned")
        .is_err());
    service
        .mark_run_terminal(
            "run-workspace-delete",
            WorkflowRunStatus::Completed,
            None,
            None,
        )
        .expect("registered worktree may outlive terminal observation");
    service
        .record_materialization_cleanup_receipt(&cleanup_receipt(&intent))
        .expect("commit exact broker cleanup receipt");
    delete_workflow
        .purge_workspace_with_sessions("workspace-owned")
        .expect("delete only after exact receipt");
    assert_eq!(
        state(&db, &intent),
        WorkflowMaterializationState::Cleaned.as_db()
    );
}

#[test]
fn stale_same_path_workspace_never_registers_new_generation_source_or_repository() {
    let (db, service) = fixture("run-stale-registration");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO repo_roots (
                id, kind, path, created_at, updated_at
             ) VALUES (
                'repo-root-other', 'external', '/tmp/other-repository',
                '2026-07-11T00:00:00Z', '2026-07-11T00:00:00Z'
             )",
            [],
        )?;
        Ok(())
    })
    .expect("seed distinct repository identity");

    let original = intent("run-stale-registration", "lane-a", 1);
    service
        .begin_materialization(&original)
        .expect("begin original");
    let workspace = materialized_workspace(&original, "workspace-original-generation");
    service
        .register_materialized_workspace(&original, &workspace)
        .expect("register original exact operation");

    let mut adversarial = Vec::new();
    let mut newer_execution = original.clone();
    newer_execution.execution_generation = 2;
    adversarial.push(newer_execution);
    let mut newer_broker = original.clone();
    newer_broker.broker_generation = 2;
    adversarial.push(newer_broker);
    let mut different_source = original.clone();
    different_source.execution_generation = 3;
    different_source.source_root = "/tmp/different-source-same-oid".into();
    adversarial.push(different_source);
    let mut different_repository = original.clone();
    different_repository.execution_generation = 4;
    different_repository.source_repo_root_id = "repo-root-other".to_string();
    different_repository.source_root = "/tmp/other-repository".into();
    adversarial.push(different_repository);

    for candidate in adversarial {
        service
            .begin_materialization(&candidate)
            .expect("begin distinct exact operation");
        assert_eq!(
            service
                .registered_workspace_for_materialization(&candidate)
                .expect("query exact registration"),
            None,
            "old path/branch/base/creator metadata must not discharge a new operation"
        );
        assert!(service
            .register_materialized_workspace(&candidate, &workspace)
            .is_err());
        assert_eq!(state(&db, &candidate), "pending");
    }
}
