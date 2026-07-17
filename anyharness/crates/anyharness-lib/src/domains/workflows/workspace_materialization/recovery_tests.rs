//! Merge-gated Tier-1 recovery battery (spec `workflow-workspace-placement`):
//! concurrent single materialization, exact adoption at every crash gap,
//! fail-closed mismatch rejection without deletion, missing-repo/base failure
//! before Git effects, and restart retention — all against real SQLite and real
//! Git. Crash-gap tests drive the exact production service functions in
//! production order and stop at the gap, then replay the PUT.

use super::model::{MaterializationFailureCode, MaterializationStatus};
use super::runtime::WorkspacePutSuccess;
use super::service::WorkflowWorkspaceService;
use super::store::MaterializationStore;
use super::test_support::{
    git_stdout, init_repo, record_of, repo_body, scratch_body, Harness, TempDirGuard, RUN_ID,
};
use crate::domains::workspaces::store::WorkspaceStore;
use crate::persistence::Db;

// ── concurrency (real SQLite + real Git) ────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_identical_puts_produce_one_materialization_and_one_artifact() {
    let harness = Harness::new("wfws-concurrent");
    let (repo_root_id, _source, head) = harness.source_repo();

    let mut handles = Vec::new();
    for _ in 0..8 {
        let runtime = harness.runtime.clone();
        let body = repo_body(RUN_ID, &repo_root_id, "main");
        handles.push(tokio::spawn(async move {
            runtime.put(RUN_ID.to_string(), body).await
        }));
    }
    let mut workspace_ids = Vec::new();
    for handle in handles {
        let outcome = handle.await.expect("join").expect("put");
        let record = record_of(&outcome);
        assert_eq!(record.status, MaterializationStatus::Ready);
        workspace_ids.push(record.workspace_id.clone().expect("workspace id"));
    }
    workspace_ids.dedup();
    assert_eq!(
        workspace_ids.len(),
        1,
        "concurrent PUTs returned different workspaces"
    );

    assert_eq!(
        harness.table_count("workflow_workspace_materializations"),
        1
    );
    assert_eq!(harness.table_count("workspaces"), 1);
    let path = harness.workflow_path(RUN_ID);
    assert_eq!(git_stdout(&path, &["rev-parse", "HEAD"]), head);
}

// ── crash gaps: exact adoption at each gap ──────────────────────────────────

#[tokio::test]
async fn crash_after_resolved_placement_persistence_replay_materializes() {
    let harness = Harness::new("wfws-gap-resolved");
    let request = harness
        .service
        .validate_request(RUN_ID, scratch_body(RUN_ID))
        .expect("valid");
    harness.service.accept(&request).expect("accept");
    let resolved = harness
        .workspace_runtime
        .resolve_workflow_placement(&request.placement)
        .expect("resolve");
    let json = serde_json::to_string(&resolved).expect("serialize");
    harness
        .service
        .persist_resolved_and_begin(RUN_ID, &json)
        .expect("persist");
    // Crash here: resolved placement durable, no filesystem state.
    assert!(!harness.workflow_path(RUN_ID).exists());

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), scratch_body(RUN_ID))
        .await
        .expect("replay");
    let record = record_of(&outcome);
    assert_eq!(record.status, MaterializationStatus::Ready);
    assert!(record.workspace_id.is_some());
    assert!(harness.workflow_path(RUN_ID).is_dir());
}

#[tokio::test]
async fn crash_after_git_artifact_creation_replay_adopts_exact_artifact() {
    let harness = Harness::new("wfws-gap-artifact");
    let (repo_root_id, source, head) = harness.source_repo();
    let request = harness
        .service
        .validate_request(RUN_ID, repo_body(RUN_ID, &repo_root_id, "main"))
        .expect("valid");
    harness.service.accept(&request).expect("accept");
    let resolved = harness
        .workspace_runtime
        .resolve_workflow_placement(&request.placement)
        .expect("resolve");
    let json = serde_json::to_string(&resolved).expect("serialize");
    harness
        .service
        .persist_resolved_and_begin(RUN_ID, &json)
        .expect("persist");
    // Production Git effect, then crash before the workspace row insert.
    let target = harness.workflow_path(RUN_ID);
    std::fs::create_dir_all(target.parent().expect("parent")).expect("parent dir");
    crate::adapters::git::GitService::create_worktree(
        source.to_str().expect("utf8"),
        target.to_str().expect("utf8"),
        &format!("workflow/{RUN_ID}"),
        Some(&head),
    )
    .expect("git artifact");
    assert_eq!(harness.table_count("workspaces"), 0);

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), repo_body(RUN_ID, &repo_root_id, "main"))
        .await
        .expect("replay");
    let record = record_of(&outcome);
    assert_eq!(record.status, MaterializationStatus::Ready);
    assert!(record.workspace_id.is_some());
    assert_eq!(harness.table_count("workspaces"), 1);
    assert_eq!(git_stdout(&target, &["rev-parse", "HEAD"]), head);
}

#[tokio::test]
async fn crash_after_workspace_row_creation_replay_binds_it() {
    let harness = Harness::new("wfws-gap-row");
    let request = harness
        .service
        .validate_request(RUN_ID, scratch_body(RUN_ID))
        .expect("valid");
    harness.service.accept(&request).expect("accept");
    let resolved = harness
        .workspace_runtime
        .resolve_workflow_placement(&request.placement)
        .expect("resolve");
    let json = serde_json::to_string(&resolved).expect("serialize");
    harness
        .service
        .persist_resolved_and_begin(RUN_ID, &json)
        .expect("persist");
    // Full workspace-owned ensure (artifact + row), then crash before binding.
    let workspace = harness
        .workspace_runtime
        .ensure_workflow_workspace(&resolved)
        .expect("ensure");
    let record = harness.service.get(RUN_ID).expect("get").expect("record");
    assert!(record.workspace_id.is_none());

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), scratch_body(RUN_ID))
        .await
        .expect("replay");
    let replayed = record_of(&outcome);
    assert_eq!(replayed.status, MaterializationStatus::Ready);
    assert_eq!(
        replayed.workspace_id.as_deref(),
        Some(workspace.id.as_str())
    );
    assert_eq!(harness.table_count("workspaces"), 1);
}

#[tokio::test]
async fn crash_after_workspace_binding_replay_terminalizes_ready() {
    let harness = Harness::new("wfws-gap-bind");
    let request = harness
        .service
        .validate_request(RUN_ID, scratch_body(RUN_ID))
        .expect("valid");
    harness.service.accept(&request).expect("accept");
    let resolved = harness
        .workspace_runtime
        .resolve_workflow_placement(&request.placement)
        .expect("resolve");
    let json = serde_json::to_string(&resolved).expect("serialize");
    harness
        .service
        .persist_resolved_and_begin(RUN_ID, &json)
        .expect("persist");
    let workspace = harness
        .workspace_runtime
        .ensure_workflow_workspace(&resolved)
        .expect("ensure");
    harness
        .service
        .bind_workspace(RUN_ID, &workspace.id)
        .expect("bind");
    // Crash before the guarded ready terminalization.
    let record = harness.service.get(RUN_ID).expect("get").expect("record");
    assert_eq!(record.status, MaterializationStatus::Materializing);

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), scratch_body(RUN_ID))
        .await
        .expect("replay");
    let replayed = record_of(&outcome);
    assert_eq!(replayed.status, MaterializationStatus::Ready);
    assert_eq!(
        replayed.workspace_id.as_deref(),
        Some(workspace.id.as_str())
    );
    assert_eq!(harness.table_count("workspaces"), 1);
}

// ── fail-closed mismatch rejection (never destructive) ──────────────────────

#[tokio::test]
async fn wrong_shape_scratch_artifact_fails_closed_without_deletion() {
    let harness = Harness::new("wfws-mismatch-scratch");
    // A pre-existing NON-scratch repository squatting on the deterministic path
    // (non-empty commit). Never adopted, never deleted.
    let target = harness.workflow_path(RUN_ID);
    std::fs::create_dir_all(&target).expect("target dir");
    init_repo(&target);

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), scratch_body(RUN_ID))
        .await
        .expect("put returns failed record");
    let record = record_of(&outcome);
    assert_eq!(record.status, MaterializationStatus::Failed);
    assert_eq!(
        record.failure_code,
        Some(MaterializationFailureCode::PlacementMismatch)
    );
    assert!(record.workspace_id.is_none());
    // The ambiguous artifact is retained for inspection.
    assert!(target.join("README.md").exists());
    assert_eq!(harness.table_count("workspaces"), 0);

    // Terminal failed does not automatically retry under the same identity.
    let replay = harness
        .runtime
        .put(RUN_ID.to_string(), scratch_body(RUN_ID))
        .await
        .expect("replay");
    assert!(matches!(replay, WorkspacePutSuccess::Replay(_)));
    assert_eq!(record_of(&replay).status, MaterializationStatus::Failed);
    assert_eq!(harness.table_count("workspaces"), 0);
}

#[tokio::test]
async fn wrong_branch_worktree_artifact_fails_closed() {
    let harness = Harness::new("wfws-mismatch-worktree");
    let (repo_root_id, source, head) = harness.source_repo();

    // An artifact at the deterministic path on the WRONG branch name.
    let target = harness.workflow_path(RUN_ID);
    std::fs::create_dir_all(target.parent().expect("parent")).expect("parent dir");
    crate::adapters::git::GitService::create_worktree(
        source.to_str().expect("utf8"),
        target.to_str().expect("utf8"),
        "not-the-workflow-branch",
        Some(&head),
    )
    .expect("wrong-branch artifact");

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), repo_body(RUN_ID, &repo_root_id, "main"))
        .await
        .expect("put");
    let record = record_of(&outcome);
    assert_eq!(record.status, MaterializationStatus::Failed);
    assert_eq!(
        record.failure_code,
        Some(MaterializationFailureCode::PlacementMismatch)
    );
    // No deletion, reset, checkout, rename, or suffix.
    assert_eq!(
        git_stdout(&target, &["symbolic-ref", "--short", "HEAD"]),
        "not-the-workflow-branch"
    );
    assert_eq!(harness.table_count("workspaces"), 0);
    assert!(!harness.workflow_path(&format!("{RUN_ID}-2")).exists());
}

#[tokio::test]
async fn wrong_provenance_workspace_row_fails_closed() {
    let harness = Harness::new("wfws-mismatch-provenance");

    // A NON-workflow workspace row already claims the deterministic path: an
    // ordinary scratch-shaped repo registered without Workflow provenance.
    let target = harness.workflow_path(RUN_ID);
    std::fs::create_dir_all(target.parent().expect("parent")).expect("parent dir");
    crate::adapters::git::GitService::init_scratch_repository(target.to_str().expect("utf8"))
        .expect("scratch-shaped repo");
    harness
        .workspace_runtime
        .create_workspace(target.to_str().expect("utf8"))
        .expect("foreign workspace row");
    assert_eq!(harness.table_count("workspaces"), 1);

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), scratch_body(RUN_ID))
        .await
        .expect("put");
    let record = record_of(&outcome);
    assert_eq!(record.status, MaterializationStatus::Failed);
    assert_eq!(
        record.failure_code,
        Some(MaterializationFailureCode::PlacementMismatch)
    );
    assert!(record.workspace_id.is_none());
    // The foreign workspace row is untouched.
    assert_eq!(harness.table_count("workspaces"), 1);
}

// ── missing repo / base failure before Git effects ──────────────────────────

#[tokio::test]
async fn missing_repo_root_and_unresolvable_base_fail_before_git_effects() {
    let harness = Harness::new("wfws-missing");

    let outcome = harness
        .runtime
        .put(
            RUN_ID.to_string(),
            repo_body(RUN_ID, "00000000-0000-4000-8000-00000000dead", "main"),
        )
        .await
        .expect("put");
    let record = record_of(&outcome);
    assert_eq!(record.status, MaterializationStatus::Failed);
    assert_eq!(
        record.failure_code,
        Some(MaterializationFailureCode::RepoRootNotFound)
    );
    assert!(record.resolved_placement_json.is_none());
    assert!(!harness.workflow_path(RUN_ID).exists());

    let (repo_root_id, _source, _head) = harness.source_repo();
    let other_run = "88888888-8888-4888-8888-888888888888";
    let outcome = harness
        .runtime
        .put(
            other_run.to_string(),
            repo_body(other_run, &repo_root_id, "no-such-branch"),
        )
        .await
        .expect("put");
    let record = record_of(&outcome);
    assert_eq!(record.status, MaterializationStatus::Failed);
    assert_eq!(
        record.failure_code,
        Some(MaterializationFailureCode::BaseRefUnresolvable)
    );
    assert!(!harness.workflow_path(other_run).exists());
}

// ── restart retention ───────────────────────────────────────────────────────

#[tokio::test]
async fn restart_retains_ready_and_failed_records_and_workspaces() {
    let root = TempDirGuard::new("wfws-restart");
    let db_home = root.path().join("dbhome");
    std::fs::create_dir_all(&db_home).expect("db home");

    let workspace_id;
    let artifact_path;
    {
        let db = Db::open(&db_home).expect("file-backed db");
        // Root the harness at the OUTER tempdir so artifacts survive its drop.
        let harness = Harness::at_external_root(root.path(), db);
        let outcome = harness
            .runtime
            .put(RUN_ID.to_string(), scratch_body(RUN_ID))
            .await
            .expect("put");
        let record = record_of(&outcome);
        assert_eq!(record.status, MaterializationStatus::Ready);
        workspace_id = record.workspace_id.clone().expect("workspace id");
        artifact_path = harness.workflow_path(RUN_ID);
        // A failed record too.
        let failed_run = "99999999-9999-4999-8999-999999999999";
        let outcome = harness
            .runtime
            .put(
                failed_run.to_string(),
                repo_body(failed_run, "00000000-0000-4000-8000-00000000dead", "main"),
            )
            .await
            .expect("put");
        assert_eq!(record_of(&outcome).status, MaterializationStatus::Failed);
    }

    // "Restart": reopen the same database file with fresh stores.
    let db = Db::open(&db_home).expect("reopen db");
    let service = WorkflowWorkspaceService::new(MaterializationStore::new(db.clone()));
    let record = service.get(RUN_ID).expect("get").expect("record survives");
    assert_eq!(record.status, MaterializationStatus::Ready);
    assert_eq!(record.workspace_id.as_deref(), Some(workspace_id.as_str()));
    let failed = service
        .get("99999999-9999-4999-8999-999999999999")
        .expect("get")
        .expect("failed record survives");
    assert_eq!(failed.status, MaterializationStatus::Failed);
    let workspace_store = WorkspaceStore::new(db);
    assert!(workspace_store
        .find_by_id(&workspace_id)
        .expect("lookup")
        .is_some());
    assert!(artifact_path.is_dir(), "artifact removed across restart");
}
