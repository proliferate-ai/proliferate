//! Adversarial CONTROL-round batteries for `workflow-workspace-placement`
//! (annotated-tag base OID, exact adoption recovery matrix, symlink/root
//! containment, gate lifecycle + stale-binding CAS, and bounded secret-free
//! failure detail) — all against real SQLite and real Git. The steady-state and
//! original crash-gap proofs live in `recovery_tests.rs`.

use super::model::{MaterializationFailureCode, MaterializationStatus, MAX_FAILURE_MESSAGE_LEN};
use super::test_support::{
    git_stdout, init_repo, record_of, repo_body, run_git, scratch_body, Harness, RUN_ID,
};
use crate::domains::workspaces::workflow_placement::WorkflowPlacementError;
use crate::persistence::Db;

// ── WSP3-GIT-01: annotated tag base ref ─────────────────────────────────────

#[tokio::test]
async fn annotated_tag_base_ref_persists_commit_oid_equal_to_checkout_head() {
    let harness = Harness::new("wfws-annotated-tag");
    let (repo_root_id, _source, tag, tag_object_oid, commit_oid) =
        harness.source_repo_with_annotated_tag();

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), repo_body(RUN_ID, &repo_root_id, &tag))
        .await
        .expect("put");
    let record = record_of(&outcome);
    assert_eq!(
        record.status,
        MaterializationStatus::Ready,
        "body: {record:?}"
    );

    // The persisted base OID is the COMMIT, not the annotated tag object.
    let resolved = record.resolved_placement().expect("resolved");
    let persisted = resolved.base_oid().expect("base oid").to_string();
    assert_eq!(
        persisted, commit_oid,
        "persisted baseOid must be the commit"
    );
    assert_ne!(
        persisted, tag_object_oid,
        "must not persist the tag object oid"
    );

    // The created checkout's HEAD equals the persisted base OID.
    let path = harness.workflow_path(RUN_ID);
    assert_eq!(git_stdout(&path, &["rev-parse", "HEAD"]), persisted);
}

// ── WSP3-ADOPTION-01: exact scratch shape (orphan + row-present) ─────────────

#[tokio::test]
async fn wrong_identity_scratch_orphan_fails_closed() {
    let harness = Harness::new("wfws-adopt-identity");
    // A scratch-SHAPED orphan (branch main, one empty commit, no remote) but
    // with a FOREIGN Git identity — not the stable AnyHarness scratch identity.
    let target = harness.workflow_path(RUN_ID);
    std::fs::create_dir_all(&target).expect("target dir");
    run_git(&target, &["init", "-b", "main"]);
    run_git(&target, &["config", "user.name", "Someone Else"]);
    run_git(&target, &["config", "user.email", "someone@example.com"]);
    run_git(&target, &["commit", "--allow-empty", "-m", "empty"]);

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
    assert_eq!(harness.table_count("workspaces"), 0);
    // Never destructive: the ambiguous artifact is retained.
    assert!(target.join(".git").exists());
}

#[tokio::test]
async fn dirty_scratch_orphan_fails_closed() {
    let harness = Harness::new("wfws-adopt-dirty");
    // A correctly shaped + identified scratch repo, but with an UNTRACKED file
    // (dirty worktree). A dirty artifact is never adopted.
    let target = harness.workflow_path(RUN_ID);
    std::fs::create_dir_all(target.parent().expect("parent")).expect("parent dir");
    crate::adapters::git::GitService::init_scratch_repository(target.to_str().expect("utf8"))
        .expect("scratch repo");
    std::fs::write(target.join("dirty.txt"), "uncommitted\n").expect("write dirty");

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
    assert_eq!(harness.table_count("workspaces"), 0);
    assert!(target.join("dirty.txt").exists(), "artifact was mutated");
}

// ── WSP3-ADOPTION-01: repository worktree linkage/common-dir ─────────────────

#[tokio::test]
async fn standalone_primary_repo_orphan_fails_closed() {
    let harness = Harness::new("wfws-adopt-standalone");
    let (repo_root_id, _source, _head) = harness.source_repo();
    // A STANDALONE primary checkout squatting on the deterministic path (not a
    // linked worktree of the source). Must be rejected as "not a linked
    // worktree", never adopted.
    let target = harness.workflow_path(RUN_ID);
    std::fs::create_dir_all(&target).expect("target dir");
    init_repo(&target);
    run_git(&target, &["checkout", "-b", &format!("workflow/{RUN_ID}")]);

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
    assert_eq!(harness.table_count("workspaces"), 0);
}

#[tokio::test]
async fn nested_repo_wrong_common_dir_orphan_fails_closed() {
    let harness = Harness::new("wfws-adopt-nested");
    let (repo_root_id, _source, head) = harness.source_repo();

    // A DIFFERENT source repository. A linked worktree of it lands on the
    // deterministic path with the right branch/OID-shape but the WRONG common
    // dir. It must not be adopted for `repo_root_id`.
    let other_source = harness.root_path.join("other-source");
    std::fs::create_dir_all(&other_source).expect("other source");
    init_repo(&other_source);
    let other_head = git_stdout(&other_source, &["rev-parse", "HEAD"]);
    // Make the other repo's HEAD match the expected commit content so only the
    // common dir differs.
    let _ = head; // expected OID belongs to the real source, not this one.
    let target = harness.workflow_path(RUN_ID);
    std::fs::create_dir_all(target.parent().expect("parent")).expect("parent dir");
    crate::adapters::git::GitService::create_worktree(
        other_source.to_str().expect("utf8"),
        target.to_str().expect("utf8"),
        &format!("workflow/{RUN_ID}"),
        Some(&other_head),
    )
    .expect("worktree of the WRONG repo");

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
    assert_eq!(harness.table_count("workspaces"), 0);
}

#[tokio::test]
async fn row_present_scratch_with_wrong_identity_fails_closed() {
    let harness = Harness::new("wfws-row-identity");
    // A workspace ROW with correct Workflow provenance and path, but the on-disk
    // repo carries a foreign identity. Row fields lining up is not enough — the
    // scratch initialization contract is reproved on disk (ADOPTION-01).
    let target = harness.workflow_path(RUN_ID);
    std::fs::create_dir_all(&target).expect("target dir");
    run_git(&target, &["init", "-b", "main"]);
    run_git(&target, &["config", "user.name", "Someone Else"]);
    run_git(&target, &["config", "user.email", "someone@example.com"]);
    run_git(&target, &["commit", "--allow-empty", "-m", "empty"]);
    harness
        .workspace_runtime
        .create_workspace_with_origin_and_creator_context(
            target.to_str().expect("utf8"),
            crate::origin::OriginContext::api_local_runtime(),
            Some(
                crate::domains::workspaces::creator_context::WorkspaceCreatorContext::Workflow {
                    run_id: RUN_ID.to_string(),
                },
            ),
        )
        .expect("workflow-provenance row");

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
}

// ── WSP3-PATH-01: fail-closed root + symlink containment ─────────────────────

#[tokio::test]
async fn invalid_managed_root_fails_closed_without_fallback() {
    use crate::domains::repo_roots::service::RepoRootService;
    use crate::domains::repo_roots::store::RepoRootStore;
    use crate::domains::workspaces::deletion::WorkspaceDeleteWorkflow;
    use crate::domains::workspaces::managed_root::{
        canonical_managed_worktrees_root, ANYHARNESS_WORKTREES_ROOT_ENV,
    };
    use crate::domains::workspaces::runtime::WorkspaceRuntime;
    use crate::domains::workspaces::store::WorkspaceStore;

    // PATH-01: a managed root the owning seam cannot canonicalize must fail
    // closed — never fall back to the raw configured value. Rather than mutate
    // the process-global `ANYHARNESS_WORKTREES_ROOT` (which every materialization
    // test now reads, so setting it would race), point a runtime at a home whose
    // grandparent does not exist, so `<home>/../worktrees` cannot canonicalize.
    //
    // This is the same failure class as a relative/invalid env override, proven
    // deterministically and without global state.
    assert!(
        std::env::var_os(ANYHARNESS_WORKTREES_ROOT_ENV).is_none(),
        "test assumes no ambient worktrees-root override"
    );
    let bogus_home = std::path::Path::new("/nonexistent-anyharness-root/deep/runtime");
    assert!(
        canonical_managed_worktrees_root(bogus_home).is_err(),
        "seam must reject an unresolvable managed root"
    );

    let db = Db::open_in_memory().expect("db");
    let workspace_runtime = WorkspaceRuntime::new(
        WorkspaceStore::new(db.clone()),
        WorkspaceDeleteWorkflow::new(
            db.clone(),
            crate::domains::sessions::deletion::SessionDeleteWorkflow::new(db.clone()),
        ),
        RepoRootService::new(RepoRootStore::new(db.clone())),
        bogus_home.to_path_buf(),
    );
    let resolve_result = workspace_runtime.resolve_workflow_placement(&scratch_body(RUN_ID));
    assert!(
        resolve_result.is_err(),
        "resolve must fail closed on an unresolvable managed root"
    );
}

#[tokio::test]
async fn symlinked_workflows_parent_fails_closed_without_escape() {
    let harness = Harness::new("wfws-symlink-parent");
    // Replace `<managed-root>/workflows` with a symlink pointing OUTSIDE the
    // managed tree. Creation must fail closed rather than initialize a repo at
    // the symlink target.
    let managed_root = std::fs::canonicalize(&harness.root_path)
        .expect("canonical root")
        .join("worktrees");
    std::fs::create_dir_all(&managed_root).expect("managed root");
    let escape = harness.root_path.join("escape-target");
    std::fs::create_dir_all(&escape).expect("escape dir");
    std::os::unix::fs::symlink(&escape, managed_root.join("workflows")).expect("symlink");

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
    // No repository initialized at the escape target.
    assert!(!escape.join(RUN_ID).join(".git").exists());
    assert_eq!(harness.table_count("workspaces"), 0);
}

// ── WSP3-RUNTIME-01: gate lifecycle + stale binding ─────────────────────────

#[tokio::test]
async fn many_unique_runs_do_not_leak_gate_slots() {
    let harness = Harness::new("wfws-gate-lifecycle");
    for _ in 0..50 {
        let run_id = uuid::Uuid::new_v4().to_string();
        let outcome = harness
            .runtime
            .put(run_id.clone(), scratch_body(&run_id))
            .await
            .expect("put");
        assert_eq!(record_of(&outcome).status, MaterializationStatus::Ready);
    }
    // Every per-run gate is dropped once its PUT completes; spent slots are
    // self-pruned so the map does not grow with unique run UUIDs.
    assert_eq!(
        harness.runtime.live_gate_slots(),
        0,
        "gate slots leaked after many unique runs"
    );
}

#[tokio::test]
async fn divergent_bound_workspace_fails_closed_rather_than_ready() {
    let harness = Harness::new("wfws-stale-binding");
    // Drive to a state where the materialization row is already bound to a
    // STALE workspace id, then run the bind CAS with a different id: the runtime
    // must fail closed instead of terminalizing ready over the stale id.
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
    // Pre-bind a STALE workspace id (a durable id that is not the artifact the
    // ensure/adopt seam will produce).
    let stale_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assert!(harness
        .service
        .bind_workspace(RUN_ID, stale_id)
        .expect("bind stale"));

    // Now replay the PUT: the row is materializing with a stale binding; the
    // fresh ensure/adopt produces a different workspace id, the bind CAS misses,
    // and the divergence must fail closed.
    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), scratch_body(RUN_ID))
        .await
        .expect("put");
    let record = record_of(&outcome);
    assert_eq!(
        record.status,
        MaterializationStatus::Failed,
        "must not terminalize ready over a stale binding"
    );
    assert_eq!(
        record.failure_code,
        Some(MaterializationFailureCode::PlacementMismatch)
    );
    assert_eq!(record.workspace_id.as_deref(), Some(stale_id));
}

// ── WSP3-FAILURE-01: bounded, secret-free failure detail ─────────────────────

#[tokio::test]
async fn failure_detail_is_bounded_and_secret_free_by_construction() {
    let harness = Harness::new("wfws-bounded-msg");
    let request = harness
        .service
        .validate_request(RUN_ID, scratch_body(RUN_ID))
        .expect("valid");
    harness.service.accept(&request).expect("accept");

    // Drive an oversized sentinel-bearing free-form mismatch through the exact
    // production mapper, then through the real store/service transition. The
    // mapper must discard every byte of the raw payload rather than relying on
    // callers to classify it safely.
    let sentinel = "ghp_SUPERSECRETTOKEN";
    let raw = format!("{sentinel}:{}", "x".repeat(MAX_FAILURE_MESSAGE_LEN * 4));
    let (code, detail) =
        MaterializationFailureCode::from_placement_error(&WorkflowPlacementError::Mismatch(raw));
    assert_eq!(code, MaterializationFailureCode::PlacementMismatch);
    harness
        .service
        .mark_failed(RUN_ID, code, &detail)
        .expect("mark failed");

    let record = harness.service.get(RUN_ID).expect("get").expect("record");
    let stored = record.failure_message.expect("failure message");
    let stored = stored.as_str();
    assert_eq!(
        record.failure_code,
        Some(MaterializationFailureCode::PlacementMismatch)
    );
    assert_eq!(stored, "placement mismatch");
    assert!(
        stored.len() <= MAX_FAILURE_MESSAGE_LEN,
        "stored failure message exceeds the bound: {}",
        stored.len()
    );
    assert!(
        !stored.contains(sentinel),
        "stored failure detail leaked a secret sentinel: {stored}"
    );
}

#[tokio::test]
async fn repository_worktree_failure_does_not_leak_git_stderr() {
    let harness = Harness::new("wfws-no-stderr");
    let (repo_root_id, source, head) = harness.source_repo();
    // Pre-create the target branch in the SOURCE so `git worktree add -b` fails
    // (branch already exists). The failure must be a bounded, secret-free code —
    // never raw Git stderr.
    run_git(&source, &["branch", &format!("workflow/{RUN_ID}"), &head]);

    let outcome = harness
        .runtime
        .put(RUN_ID.to_string(), repo_body(RUN_ID, &repo_root_id, "main"))
        .await
        .expect("put");
    let record = record_of(&outcome);
    assert_eq!(record.status, MaterializationStatus::Failed);
    assert_eq!(
        record.failure_code,
        Some(MaterializationFailureCode::GitFailed)
    );
    let message = record
        .failure_message
        .as_ref()
        .map(|detail| detail.as_str().to_string())
        .unwrap_or_default();
    // No raw Git stderr fragments in the stored detail.
    assert!(
        !message.contains("already exists") && !message.contains("fatal:"),
        "stored failure leaked git stderr: {message}"
    );
}
