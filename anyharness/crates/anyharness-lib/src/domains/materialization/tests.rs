//! Unit tests for materialization pure logic: ledger admission, request-hash
//! conflict, exact-ref error classification, and the clone auth classifier.
//! End-to-end git integration tests live in `service_git_tests.rs`.

use super::model::{
    MaterializationError, MaterializationKind, MaterializationOperationRecord, MaterializationState,
};
use super::operation_lock::MaterializationOperationLocks;
use super::service::{
    admit_existing, begin_operation, hash_request, hashed_destination_form, map_exact_ref_error,
    Admission, AdmissionPlan,
};
use super::store::MaterializationOperationStore;
use crate::persistence::Db;

fn record(
    kind: MaterializationKind,
    state: MaterializationState,
    hash: &str,
) -> MaterializationOperationRecord {
    MaterializationOperationRecord {
        operation_id: "op-1".into(),
        kind,
        request_hash: hash.into(),
        state,
        intended_kind: None,
        repo_root_id: None,
        workspace_id: None,
        destination_path: None,
        observed_head_sha: None,
        failure_code: None,
        created_at: "2026-07-15T00:00:00Z".into(),
        updated_at: "2026-07-15T00:00:00Z".into(),
    }
}

#[test]
fn completed_op_replays() {
    let existing = record(
        MaterializationKind::RepoRoot,
        MaterializationState::Completed,
        "hash-a",
    );
    let admission =
        admit_existing(&existing, MaterializationKind::RepoRoot, "hash-a").expect("admit");
    assert_eq!(admission, Admission::Replay);
}

#[test]
fn failed_op_with_matching_hash_retries() {
    let existing = record(
        MaterializationKind::RepoRoot,
        MaterializationState::Failed,
        "hash-a",
    );
    let admission =
        admit_existing(&existing, MaterializationKind::RepoRoot, "hash-a").expect("admit");
    assert_eq!(admission, Admission::Retry);
}

#[test]
fn running_op_converges_via_retry() {
    let existing = record(
        MaterializationKind::Workspace,
        MaterializationState::Running,
        "hash-a",
    );
    let admission =
        admit_existing(&existing, MaterializationKind::Workspace, "hash-a").expect("admit");
    assert_eq!(admission, Admission::Retry);
}

#[test]
fn different_request_hash_is_operation_conflict() {
    let existing = record(
        MaterializationKind::RepoRoot,
        MaterializationState::Completed,
        "hash-a",
    );
    let error = admit_existing(&existing, MaterializationKind::RepoRoot, "hash-b")
        .expect_err("hash mismatch conflicts");
    assert_eq!(error.code(), "MATERIALIZATION_OPERATION_CONFLICT");
}

#[test]
fn different_kind_same_id_is_operation_conflict() {
    let existing = record(
        MaterializationKind::RepoRoot,
        MaterializationState::Completed,
        "hash-a",
    );
    let error = admit_existing(&existing, MaterializationKind::Workspace, "hash-a")
        .expect_err("kind mismatch conflicts");
    assert_eq!(error.code(), "MATERIALIZATION_OPERATION_CONFLICT");
}

#[test]
fn repo_root_hash_distinguishes_clone_url() {
    // Same operation id + identity + destination but a different clone URL must
    // hash differently, so a same-id retry that swaps the source repo becomes a
    // conflict rather than a silent double-execution (Finding 3).
    let dest = hashed_destination_form("/tmp/anyharness-hash-dest/widget");
    let parts_a = [
        "repo_root",
        "op-1",
        "github",
        "acme",
        "widget",
        "https://github.com/acme/widget.git",
        dest.as_str(),
    ];
    let parts_b = [
        "repo_root",
        "op-1",
        "github",
        "acme",
        "widget",
        "https://github.com/attacker/widget.git",
        dest.as_str(),
    ];
    assert_ne!(hash_request(&parts_a), hash_request(&parts_b));
    // Identical parts hash identically (idempotent replay/converge).
    assert_eq!(hash_request(&parts_a), hash_request(&parts_a));
}

#[test]
fn workspace_hash_distinguishes_all_request_fields() {
    // PR3-HASH-03: every behavior-changing workspace field must be in the hash,
    // so reusing an operation id with any changed field is a conflict.
    let base = || {
        vec![
            "workspace".to_string(),
            "op-1".to_string(),
            "root-1".to_string(),
            "main".to_string(),
            "a".repeat(40),
            "dest-1".to_string(),
            "pref-name".to_string(),
        ]
    };
    let hash_of = |v: &[String]| {
        let refs: Vec<&str> = v.iter().map(String::as_str).collect();
        hash_request(&refs)
    };
    let baseline = hash_of(&base());
    // Flip each field in turn; each must change the hash.
    for index in [2usize, 3, 4, 5, 6] {
        let mut variant = base();
        variant[index] = format!("{}-changed", variant[index]);
        assert_ne!(
            baseline,
            hash_of(&variant),
            "changing field {index} must change the workspace hash"
        );
    }
}

#[test]
fn hashed_destination_form_falls_back_when_uncanonicalizable() {
    // A relative path has no existing absolute ancestor to canonicalize, so the
    // form falls back to the input verbatim (still deterministic).
    assert_eq!(hashed_destination_form("relative/path"), "relative/path");
}

#[test]
fn exact_ref_branch_mismatch_classified() {
    let error = map_exact_ref_error(anyhow::anyhow!(
        "destination is on branch x, not requested branch y"
    ));
    assert_eq!(error.code(), "WORKSPACE_BRANCH_MISMATCH");
}

#[test]
fn exact_ref_dirty_classified() {
    let error = map_exact_ref_error(anyhow::anyhow!(
        "destination worktree has uncommitted changes"
    ));
    assert_eq!(error.code(), "WORKSPACE_DIRTY");
}

#[test]
fn exact_ref_head_mismatch_classified() {
    let error = map_exact_ref_error(anyhow::anyhow!(
        "destination is at abc123, not requested commit for def"
    ));
    assert_eq!(error.code(), "WORKSPACE_HEAD_MISMATCH");
}

#[test]
fn exact_ref_missing_ref_classified() {
    let error = map_exact_ref_error(anyhow::anyhow!(
        "git rev-parse --verify deadbeef^{{commit}} failed: unknown revision"
    ));
    assert_eq!(error.code(), "REQUESTED_REF_NOT_FOUND");
}

#[test]
fn error_conflict_status_partitioning() {
    assert!(MaterializationError::DestinationNotEmpty("x".into()).is_conflict());
    assert!(MaterializationError::WorkspaceBusy("x".into()).is_conflict());
    assert!(MaterializationError::OperationConflict("x".into()).is_conflict());
    assert!(!MaterializationError::RepositoryAuthRequired("x".into()).is_conflict());
    assert!(!MaterializationError::RequestedRefNotFound("x".into()).is_conflict());
    assert!(!MaterializationError::RepositoryRemoteMismatch("x".into()).is_conflict());
}

#[test]
fn operation_conflict_has_no_ledger_failure_code() {
    assert_eq!(
        MaterializationError::OperationConflict("x".into()).ledger_failure_code(),
        None
    );
    assert_eq!(
        MaterializationError::RepositoryAuthRequired("x".into()).ledger_failure_code(),
        Some("REPOSITORY_AUTH_REQUIRED")
    );
}

#[tokio::test]
async fn concurrent_identical_operations_converge_to_one_execution() {
    // Two callers issue the SAME operation id AND the SAME normalized request
    // concurrently against one shared ledger + in-process lock. The frozen
    // contract requires them to CONVERGE (PR3-CONVERGENCE-01): exactly one
    // executes, and the other WAITS for it and replays the completed result —
    // it must NOT receive OPERATION_CONFLICT, and there must be exactly one
    // execution. A slow-clone stub (the guard held across a sleep while the
    // ledger row is completed) models the real execution window.
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let db = Db::open_in_memory().expect("db");
    let store = MaterializationOperationStore::new(db.clone());
    let locks = MaterializationOperationLocks::new();
    let hash = hash_request(&["repo_root", "op-conv", "github", "acme", "widget"]);
    let executions = Arc::new(AtomicUsize::new(0));

    // One caller's turn: admit, and on Proceed run the slow-clone stub (hold the
    // guard across an await, then complete the ledger row) before dropping it.
    async fn run_turn(
        store: MaterializationOperationStore,
        locks: MaterializationOperationLocks,
        hash: String,
        executions: Arc<AtomicUsize>,
    ) -> Result<&'static str, String> {
        match begin_operation(&store, &locks, "op-conv", MaterializationKind::RepoRoot, &hash)
            .await
        {
            Ok(AdmissionPlan::Proceed { guard, .. }) => {
                // Slow-clone stub: real work happens here, holding the guard so a
                // concurrent identical caller blocks (converges) rather than
                // racing a second clone.
                executions.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(40)).await;
                store
                    .mark_completed_repo_root("op-conv", "root-conv", "/tmp/op-conv")
                    .map_err(|e| e.to_string())?;
                drop(guard);
                Ok("executed")
            }
            Ok(AdmissionPlan::Replay(record)) => {
                assert_eq!(record.repo_root_id.as_deref(), Some("root-conv"));
                Ok("replayed")
            }
            Err(error) => Err(error.code().to_string()),
        }
    }

    let a = tokio::spawn(run_turn(
        store.clone(),
        locks.clone(),
        hash.clone(),
        executions.clone(),
    ));
    let b = tokio::spawn(run_turn(
        store.clone(),
        locks.clone(),
        hash.clone(),
        executions.clone(),
    ));
    let results = [a.await.unwrap(), b.await.unwrap()];

    assert_eq!(
        executions.load(Ordering::SeqCst),
        1,
        "exactly one clone executes: {results:?}"
    );
    let executed = results.iter().filter(|r| matches!(r, Ok("executed"))).count();
    let replayed = results.iter().filter(|r| matches!(r, Ok("replayed"))).count();
    assert_eq!(executed, 1, "one caller executes: {results:?}");
    assert_eq!(
        replayed, 1,
        "the identical concurrent caller converges via replay, never conflicts: {results:?}"
    );
}

#[tokio::test]
async fn concurrent_same_id_different_request_still_conflicts() {
    // Convergence is only for identical requests. A same-id caller with a
    // DIFFERENT normalized request (request-hash mismatch) must still conflict,
    // whether or not a live holder is running.
    let db = Db::open_in_memory().expect("db");
    let store = MaterializationOperationStore::new(db.clone());
    let locks = MaterializationOperationLocks::new();
    let hash_a = hash_request(&["repo_root", "op-diff", "github", "acme", "widget"]);
    let hash_b = hash_request(&["repo_root", "op-diff", "github", "acme", "gadget"]);

    // First caller claims the id and stays "running" (guard held).
    let first = match begin_operation(
        &store,
        &locks,
        "op-diff",
        MaterializationKind::RepoRoot,
        &hash_a,
    )
    .await
    .expect("first admits")
    {
        AdmissionPlan::Proceed { guard, .. } => guard,
        AdmissionPlan::Replay(_) => panic!("fresh op must proceed"),
    };

    // A concurrent same-id caller with a DIFFERENT request hash conflicts on the
    // lock-free check — it never waits on the live holder.
    let error = match begin_operation(
        &store,
        &locks,
        "op-diff",
        MaterializationKind::RepoRoot,
        &hash_b,
    )
    .await
    {
        Ok(_) => panic!("different request must conflict, not admit"),
        Err(error) => error,
    };
    assert_eq!(error.code(), "MATERIALIZATION_OPERATION_CONFLICT");
    drop(first);
}

#[tokio::test]
async fn crash_recovery_retry_adopts_dead_running_row() {
    // A running row with NO in-process holder is a crashed op: a retry must be
    // admitted (Proceed), recovering the recorded clone intent — proving the
    // convergence wait does not break genuine crash recovery (Finding 1).
    let db = Db::open_in_memory().expect("db");
    let store = MaterializationOperationStore::new(db.clone());
    let locks = MaterializationOperationLocks::new();
    let hash = hash_request(&["repo_root", "op-crash", "github", "acme", "widget"]);

    // Seed a durable running row with a recorded clone intent (as a crashed
    // clone attempt would have left it), with no live in-process guard.
    store
        .insert_running("op-crash", MaterializationKind::RepoRoot, &hash)
        .expect("insert running");
    store
        .set_intended_kind("op-crash", "managed")
        .expect("record intent");

    match begin_operation(
        &store,
        &locks,
        "op-crash",
        MaterializationKind::RepoRoot,
        &hash,
    )
    .await
    .expect("crash recovery admits")
    {
        AdmissionPlan::Proceed {
            recovered_intended_kind,
            ..
        } => {
            assert_eq!(recovered_intended_kind.as_deref(), Some("managed"));
        }
        AdmissionPlan::Replay(_) => panic!("crashed running row must retry, not replay"),
    }
}

#[test]
fn clone_stderr_auth_classifier() {
    use crate::adapters::git::operations::clone::stderr_indicates_auth_failure;
    assert!(stderr_indicates_auth_failure(
        "fatal: Authentication failed for 'https://github.com/o/r.git/'"
    ));
    assert!(stderr_indicates_auth_failure(
        "git@github.com: Permission denied (publickey)."
    ));
    assert!(stderr_indicates_auth_failure(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
    ));
    assert!(!stderr_indicates_auth_failure(
        "fatal: repository 'https://github.com/o/r.git/' not found"
    ));
    assert!(!stderr_indicates_auth_failure(
        "fatal: unable to access: Could not resolve host: github.com"
    ));
}
