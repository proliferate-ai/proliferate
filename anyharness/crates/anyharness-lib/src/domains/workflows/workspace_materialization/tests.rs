//! Merge-gated Tier-1 placement battery (spec `workflow-workspace-placement`):
//! strict API, canonical acceptance/replay/conflict, deterministic scratch and
//! repository-worktree placement, moved-ref immutability, and the schema-v2
//! run-acceptance guard classification — all against real SQLite and real Git.
//! Crash-gap, mismatch, concurrency, failure, and restart proofs live in
//! `recovery_tests.rs`.

use super::model::{
    MaterializationFailureCode, MaterializationFailureDetail, MaterializationStatus,
};
use super::runtime::{WorkspacePutError, WorkspacePutSuccess};
use super::service::{MaterializationValidationError, RunAcceptanceGuard};
use super::store::StoreAcceptOutcome;
use super::test_support::{
    git_stdout, record_of, repo_body, run_git, scratch_body, Harness, RUN_ID,
};
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;

// ── canonical run-id validation ─────────────────────────────────────────────
//
// Strict wire decode (unknown fields, schema version, kind/field pairing) is a
// property of the HTTP contract boundary and is proved end-to-end in
// `api::workflow_workspaces_tests`. The service owns only canonical-UUID
// validation of an already-decoded placement.

#[tokio::test]
async fn validate_request_rejects_a_non_canonical_run_id() {
    let harness = Harness::new("wfws-strict");

    let error = harness
        .service
        .validate_request("not-a-uuid", scratch_body("not-a-uuid"))
        .expect_err("bad id");
    assert!(matches!(
        error,
        MaterializationValidationError::InvalidRunId
    ));

    // A canonical UUID validates.
    assert!(harness
        .service
        .validate_request(RUN_ID, scratch_body(RUN_ID))
        .is_ok());
}

// ── acceptance, replay, conflict (real SQLite) ──────────────────────────────

#[tokio::test]
async fn accept_is_canonical_and_conflicts_on_different_placement() {
    let harness = Harness::new("wfws-accept");

    let request = harness
        .service
        .validate_request(RUN_ID, scratch_body(RUN_ID))
        .expect("valid");
    assert!(matches!(
        harness.service.accept(&request).expect("accept"),
        StoreAcceptOutcome::Created(_)
    ));

    // An identical placement normalizes to the same canonical request_json,
    // independent of the typed value's construction.
    let replay_request = harness
        .service
        .validate_request(RUN_ID, scratch_body(RUN_ID))
        .expect("valid");
    assert_eq!(request.request_json, replay_request.request_json);
    assert!(matches!(
        harness.service.accept(&replay_request).expect("replay"),
        StoreAcceptOutcome::ExactReplay(_)
    ));

    // Same run id, different placement -> Conflict, row unchanged.
    let conflicting = harness
        .service
        .validate_request(RUN_ID, repo_body(RUN_ID, "some-root", "main"))
        .expect("valid");
    assert!(matches!(
        harness.service.accept(&conflicting).expect("conflict"),
        StoreAcceptOutcome::Conflict
    ));
    let record = harness.service.get(RUN_ID).expect("get").expect("record");
    assert_eq!(record.request_json, request.request_json);
    assert_eq!(record.status, MaterializationStatus::Accepted);
}

// ── scratch placement (real Git) ────────────────────────────────────────────

#[tokio::test]
async fn scratch_put_materializes_one_blank_visible_workspace_and_replays_it() {
    let harness = Harness::new("wfws-scratch");

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), scratch_body(RUN_ID))
        .await
        .expect("put");
    let record = record_of(&outcome);
    assert!(matches!(outcome, WorkspacePutSuccess::Created(_)));
    assert_eq!(record.status, MaterializationStatus::Ready);
    let workspace_id = record.workspace_id.clone().expect("workspace id");

    // Exact deterministic path, initial branch main, exactly one empty commit,
    // stable non-personal identity, no remote.
    let path = harness.workflow_path(RUN_ID);
    assert!(path.is_dir(), "scratch artifact missing at {path:?}");
    assert_eq!(
        git_stdout(&path, &["symbolic-ref", "--short", "HEAD"]),
        "main"
    );
    assert_eq!(git_stdout(&path, &["rev-list", "--count", "HEAD"]), "1");
    assert_eq!(
        git_stdout(&path, &["rev-parse", "HEAD^{tree}"]),
        "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
        "initial commit is not empty"
    );
    assert_eq!(git_stdout(&path, &["remote"]), "");
    assert_eq!(
        git_stdout(&path, &["config", "user.name"]),
        "AnyHarness Workflow"
    );
    assert_eq!(
        git_stdout(&path, &["log", "-1", "--format=%an <%ae>"]),
        "AnyHarness Workflow <workflow@anyharness.local>"
    );

    // A visible ordinary workspace with Workflow provenance and display name.
    let workspace = harness
        .workspace_runtime
        .get_workspace(&workspace_id)
        .expect("lookup")
        .expect("workspace row");
    assert_eq!(
        workspace.display_name.as_deref(),
        Some(format!("Workflow run {RUN_ID}").as_str())
    );
    assert_eq!(
        workspace.creator_context,
        Some(WorkspaceCreatorContext::Workflow {
            run_id: RUN_ID.to_string()
        })
    );

    // Materialization alone leaves zero runs, steps, sessions, and prompts.
    assert_eq!(harness.table_count("workflow_runs"), 0);
    assert_eq!(harness.table_count("workflow_run_steps"), 0);
    assert_eq!(harness.table_count("sessions"), 0);
    assert_eq!(harness.table_count("session_pending_prompts"), 0);

    // Identical replay returns the same workspaceId and creates nothing new.
    let replay = harness
        .runtime
        .put(RUN_ID.to_string(), scratch_body(RUN_ID))
        .await
        .expect("replay");
    assert!(matches!(replay, WorkspacePutSuccess::Replay(_)));
    assert_eq!(
        record_of(&replay).workspace_id.as_deref(),
        Some(workspace_id.as_str())
    );
    assert_eq!(harness.table_count("workspaces"), 1);
    assert_eq!(
        harness.table_count("workflow_workspace_materializations"),
        1
    );
    assert_eq!(git_stdout(&path, &["rev-list", "--count", "HEAD"]), "1");
}

// ── repository worktree placement (real Git) ────────────────────────────────

#[tokio::test]
async fn repository_put_creates_worktree_at_exact_oid_branch_and_path() {
    let harness = Harness::new("wfws-repo");
    let (repo_root_id, _source, head) = harness.source_repo();

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), repo_body(RUN_ID, &repo_root_id, "main"))
        .await
        .expect("put");
    let record = record_of(&outcome);
    assert_eq!(record.status, MaterializationStatus::Ready);
    let workspace_id = record.workspace_id.clone().expect("workspace id");

    let path = harness.workflow_path(RUN_ID);
    assert!(path.is_dir());
    assert_eq!(
        git_stdout(&path, &["symbolic-ref", "--short", "HEAD"]),
        format!("workflow/{RUN_ID}")
    );
    assert_eq!(git_stdout(&path, &["rev-parse", "HEAD"]), head);
    let resolved = record.resolved_placement().expect("resolved");
    assert_eq!(resolved.base_oid(), Some(head.as_str()));

    // Replay: same branch/path/workspaceId, no suffix, no second artifact.
    let replay = harness
        .runtime
        .put(RUN_ID.to_string(), repo_body(RUN_ID, &repo_root_id, "main"))
        .await
        .expect("replay");
    assert_eq!(
        record_of(&replay).workspace_id.as_deref(),
        Some(workspace_id.as_str())
    );
    assert_eq!(harness.table_count("workspaces"), 1);
    assert!(!harness.workflow_path(&format!("{RUN_ID}-2")).exists());
}

#[tokio::test]
async fn moved_base_ref_after_resolution_still_materializes_persisted_oid() {
    let harness = Harness::new("wfws-moved-ref");
    let (repo_root_id, source, original_head) = harness.source_repo();

    // Production order: accept, resolve, persist resolved placement — then stop
    // (crash before any Git effect).
    let request = harness
        .service
        .validate_request(RUN_ID, repo_body(RUN_ID, &repo_root_id, "main"))
        .expect("valid");
    harness.service.accept(&request).expect("accept");
    let resolved = harness
        .workspace_runtime
        .resolve_workflow_placement(&request.placement)
        .expect("resolve");
    assert_eq!(resolved.base_oid(), Some(original_head.as_str()));
    let json = serde_json::to_string(&resolved).expect("serialize");
    assert!(harness
        .service
        .persist_resolved_and_begin(RUN_ID, &json)
        .expect("persist"));

    // Move main after acceptance.
    std::fs::write(source.join("MOVED.md"), "moved\n").expect("write");
    run_git(&source, &["add", "MOVED.md"]);
    run_git(&source, &["commit", "-m", "Move main"]);
    let moved_head = git_stdout(&source, &["rev-parse", "HEAD"]);
    assert_ne!(moved_head, original_head);

    // Replay: the worktree is created from the persisted OID, not re-resolved.
    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), repo_body(RUN_ID, &repo_root_id, "main"))
        .await
        .expect("replay");
    assert_eq!(record_of(&outcome).status, MaterializationStatus::Ready);
    let path = harness.workflow_path(RUN_ID);
    assert_eq!(git_stdout(&path, &["rev-parse", "HEAD"]), original_head);
}

// ── run-acceptance guard classification ─────────────────────────────────────

#[tokio::test]
async fn run_acceptance_guard_classifies_missing_not_ready_mismatch_and_ready() {
    let harness = Harness::new("wfws-guard");

    // No materialization row.
    assert_eq!(
        harness
            .service
            .guard_run_acceptance(RUN_ID, "any-workspace")
            .expect("guard"),
        RunAcceptanceGuard::NoMaterialization
    );

    // Accepted (nonterminal) -> NotReady.
    let request = harness
        .service
        .validate_request(RUN_ID, scratch_body(RUN_ID))
        .expect("valid");
    harness.service.accept(&request).expect("accept");
    assert_eq!(
        harness
            .service
            .guard_run_acceptance(RUN_ID, "any-workspace")
            .expect("guard"),
        RunAcceptanceGuard::NotReady
    );

    // Failed (terminal but not ready) -> NotReady.
    harness
        .service
        .mark_failed(
            RUN_ID,
            MaterializationFailureCode::GitFailed,
            &MaterializationFailureDetail::from_code(MaterializationFailureCode::GitFailed),
        )
        .expect("fail");
    assert_eq!(
        harness
            .service
            .guard_run_acceptance(RUN_ID, "any-workspace")
            .expect("guard"),
        RunAcceptanceGuard::NotReady
    );

    // Ready via the real flow on a second run.
    let ready_run = "66666666-6666-4666-8666-666666666666";
    let outcome = harness
        .runtime
        .put(ready_run.to_string(), scratch_body(ready_run))
        .await
        .expect("put");
    let ready_workspace = record_of(&outcome)
        .workspace_id
        .clone()
        .expect("workspace id");
    assert_eq!(
        harness
            .service
            .guard_run_acceptance(ready_run, &ready_workspace)
            .expect("guard"),
        RunAcceptanceGuard::Ready
    );
    assert_eq!(
        harness
            .service
            .guard_run_acceptance(ready_run, "a-different-workspace")
            .expect("guard"),
        RunAcceptanceGuard::Mismatch
    );
}

// ── conflict at the runtime boundary ────────────────────────────────────────

#[tokio::test]
async fn runtime_put_conflicts_on_different_placement_and_changes_nothing() {
    let harness = Harness::new("wfws-conflict");
    let (repo_root_id, _source, _head) = harness.source_repo();

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), scratch_body(RUN_ID))
        .await
        .expect("put");
    assert_eq!(record_of(&outcome).status, MaterializationStatus::Ready);

    let error = harness
        .runtime
        .put(RUN_ID.to_string(), repo_body(RUN_ID, &repo_root_id, "main"))
        .await
        .expect_err("conflict");
    assert!(matches!(error, WorkspacePutError::Conflict));
    assert_eq!(
        harness.table_count("workflow_workspace_materializations"),
        1
    );
    assert_eq!(harness.table_count("workspaces"), 1);
}
