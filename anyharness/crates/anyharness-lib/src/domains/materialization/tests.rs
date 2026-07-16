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

#[test]
fn concurrent_same_operation_admits_exactly_one_live_runner() {
    // Two callers issue the SAME operation id concurrently against one shared
    // ledger + in-process lock. Exactly one must be admitted to Proceed (and so
    // execute); the other must get a retryable OPERATION_CONFLICT rather than a
    // second concurrent execution (Finding 1 blocker).
    use std::sync::{Arc, Barrier};

    let db = Db::open_in_memory().expect("db");
    let store = MaterializationOperationStore::new(db.clone());
    let locks = MaterializationOperationLocks::new();
    let hash = hash_request(&["repo_root", "op-conc", "github", "acme", "widget"]);

    let barrier = Arc::new(Barrier::new(2));
    let outcome = |plan: Result<AdmissionPlan, MaterializationError>| -> Result<bool, String> {
        match plan {
            // Hold the guard alive (as a real op would) while we report; the
            // caller drops it after both threads have reported.
            Ok(AdmissionPlan::Proceed { guard, .. }) => {
                std::mem::forget(guard);
                Ok(true)
            }
            Ok(AdmissionPlan::Replay(_)) => Ok(false),
            Err(error) => Err(error.code().to_string()),
        }
    };

    let results: Vec<_> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let store = store.clone();
                let locks = locks.clone();
                let hash = hash.clone();
                let barrier = barrier.clone();
                scope.spawn(move || {
                    barrier.wait();
                    outcome(begin_operation(
                        &store,
                        &locks,
                        "op-conc",
                        MaterializationKind::RepoRoot,
                        &hash,
                    ))
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });

    let proceeded = results.iter().filter(|r| matches!(r, Ok(true))).count();
    let conflicted = results
        .iter()
        .filter(|r| matches!(r, Err(code) if code == "MATERIALIZATION_OPERATION_CONFLICT"))
        .count();
    assert_eq!(proceeded, 1, "exactly one caller executes: {results:?}");
    assert_eq!(
        conflicted, 1,
        "the other gets OPERATION_CONFLICT: {results:?}"
    );
}

#[test]
fn crash_recovery_retry_adopts_dead_running_row() {
    // A running row with NO in-process holder is a crashed op: a retry must be
    // admitted (Proceed), recovering the recorded clone intent — proving live
    // rejection does not break genuine crash recovery (Finding 1).
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
