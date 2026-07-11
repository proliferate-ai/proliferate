//! Tests for [`super::parallel`], split into a sibling file for line budget
//! (matching the repo's `*_tests.rs` convention, e.g.
//! `domains/workflows/service_tests.rs`).

use crate::domains::workflows::engine::StepOutcome;
use crate::domains::workflows::plan::{Isolation, NO_LANE};

use super::parallel::{
    adoptable_run_worktree, recover_resume_worktree, resolve_effective_workspace,
    run_worktree_base_ref, run_worktree_branch_name, run_worktree_target_path,
    worktree_base_workspace_id, worktree_branch_for_scope, worktree_target_path_for_scope,
};

fn outcome_code(outcome: &StepOutcome) -> &str {
    match outcome {
        StepOutcome::Failed { code, .. } => code,
        _ => panic!("expected Failed outcome"),
    }
}

fn failed_msg(code: &str, message: impl Into<String>) -> StepOutcome {
    StepOutcome::Failed {
        code: code.to_string(),
        message: Some(message.into()),
        output: None,
    }
}

#[tokio::test]
async fn workspace_isolation_returns_pinned_and_never_mints() {
    // Under the default (legacy) isolation, the run resolves to its pinned
    // workspace and the worktree mint is never invoked. (Async now: the mint
    // runs on `spawn_blocking` behind an async-aware memo lock.)
    let memo = tokio::sync::Mutex::new(None);
    let minted = std::sync::atomic::AtomicU32::new(0);
    let resolved = resolve_effective_workspace(Isolation::Workspace, "ws-pinned", &memo, || {
        minted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        async { Ok("ws-worktree".to_string()) }
    })
    .await
    .expect("workspace isolation resolves");
    assert_eq!(resolved, "ws-pinned");
    assert_eq!(minted.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[tokio::test]
async fn worktree_isolation_mints_once_and_every_slot_shares_it() {
    // DENY-PATH (d) + one-worktree-per-run: the mint runs exactly once; every
    // subsequent resolution (a second slot, a shell step) returns the SAME
    // worktree workspace id without re-minting.
    let memo = tokio::sync::Mutex::new(None);
    let mints = std::sync::atomic::AtomicU32::new(0);
    let first = resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, || {
        let n = mints.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        async move { Ok(format!("ws-worktree-{n}")) }
    })
    .await
    .expect("mint");
    let second = resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, || {
        mints.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        async { Ok("ws-worktree-SECOND".to_string()) }
    })
    .await
    .expect("memoized");
    assert_eq!(first, "ws-worktree-0");
    assert_eq!(second, first, "all slots must share the one minted worktree");
    assert_eq!(
        mints.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "the worktree must be minted once per run, never per slot"
    );
}

#[tokio::test]
async fn worktree_mint_failure_propagates_and_leaves_no_effective_workspace() {
    // DENY-PATH (b): a failed mint surfaces the structured error and does NOT
    // memoize a fallback — because callers resolve the workspace BEFORE
    // creating a session, this fails the run with no session in the shared
    // checkout. A later resolution retries the mint (memo still empty).
    let memo = tokio::sync::Mutex::new(None);
    let outcome = resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, || async {
        Err(failed_msg("worktree_mint_failed", "git worktree add failed: dirty"))
    })
    .await
    .expect_err("mint failure must propagate");
    assert_eq!(outcome_code(&outcome), "worktree_mint_failed");
    assert!(
        memo.lock().await.is_none(),
        "a failed mint must not silently fall back to the pinned checkout"
    );
}

#[test]
fn adoptable_run_worktree_adopts_only_the_runs_own_branch() {
    let expected = run_worktree_branch_name("run-x");
    // Adoption: a record at the run's path on the run's OWN branch is adopted.
    assert_eq!(
        adoptable_run_worktree(Some(("ws-wt".to_string(), Some(expected.clone()))), &expected),
        Some("ws-wt".to_string()),
    );
    // Run-scoped only: a record squatting the path on a DIFFERENT branch is
    // NOT adopted (caller falls through to an honest mint conflict).
    assert_eq!(
        adoptable_run_worktree(
            Some(("ws-foreign".to_string(), Some("feature/other".to_string()))),
            &expected,
        ),
        None,
    );
    // A record with no recorded branch is not adoptable (can't prove it's ours).
    assert_eq!(
        adoptable_run_worktree(Some(("ws-detached".to_string(), None)), &expected),
        None,
    );
    // Half-created (git worktree on disk but NO record) → lookup finds nothing
    // → not adoptable → caller mints and fails honestly.
    assert_eq!(adoptable_run_worktree(None, &expected), None);
}

#[tokio::test]
async fn resolve_adopts_existing_worktree_without_a_second_mint() {
    // Finding 1: when the run's own worktree record already exists (a prior
    // executor minted it before crashing), the "mint" closure adopts it and
    // resolve memoizes that id — a subsequent resolution never mints again.
    let expected = run_worktree_branch_name("run-x");
    let memo = tokio::sync::Mutex::new(None);
    let mint_calls = std::sync::atomic::AtomicU32::new(0);
    let adopt_or_mint = || {
        mint_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let expected = expected.clone();
        async move {
            // Stub lookup: the run's own record already exists.
            let found = Some(("ws-adopted".to_string(), Some(expected.clone())));
            adoptable_run_worktree(found, &expected)
                .ok_or_else(|| failed_msg("worktree_mint_failed", "would have minted"))
        }
    };
    let first = resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, adopt_or_mint)
        .await
        .expect("adopts the existing worktree");
    assert_eq!(first, "ws-adopted");
    // Second resolution is served from the memo, never re-adopting/minting.
    let second =
        resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, || async {
            panic!("must not mint/adopt again once memoized")
        })
        .await
        .expect("memoized");
    assert_eq!(second, "ws-adopted");
    assert_eq!(mint_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(memo.lock().await.as_deref(), Some("ws-adopted"));
}

#[tokio::test]
async fn half_created_worktree_fails_honestly_rather_than_adopting() {
    // Finding 1: a git worktree exists on disk but has NO workspace record
    // (half-created before a crash). The adoption lookup returns None, so we do
    // NOT adopt untracked state; the mint runs and conflicts on the occupied
    // path — a structured failure, not a silent adopt.
    let expected = run_worktree_branch_name("run-x");
    let memo = tokio::sync::Mutex::new(None);
    let outcome = resolve_effective_workspace(Isolation::Worktree, "ws-pinned", &memo, || {
        let expected = expected.clone();
        async move {
            // Stub lookup: no record (half-created).
            match adoptable_run_worktree(None, &expected) {
                Some(id) => Ok(id),
                None => Err(failed_msg(
                    "worktree_mint_failed",
                    "worktree target path already exists",
                )),
            }
        }
    })
    .await
    .expect_err("half-created worktree must fail honestly");
    assert_eq!(outcome_code(&outcome), "worktree_mint_failed");
    assert!(memo.lock().await.is_none());
}

#[tokio::test]
async fn resume_adopts_existing_worktree_when_no_session_persisted_yet() {
    // Finding 1 (belt-and-suspenders): a fresh executor resuming a run that
    // persisted NO session (a shell/PR-only prefix) still recovers the run's
    // worktree by ADOPTING its record — so resume resolves to the worktree
    // without minting even before the first step runs.
    let expected = run_worktree_branch_name("run-x");
    let recovered = recover_resume_worktree(None, &expected, || {
        let expected = expected.clone();
        async move { Ok(Some(("ws-adopted".to_string(), Some(expected.clone())))) }
    })
    .await
    .expect("resume lookup ok");
    assert_eq!(recovered, Some("ws-adopted".to_string()));
}

#[tokio::test]
async fn resume_prefers_a_recovered_session_and_skips_the_lookup() {
    // A persisted session already lives in the worktree: its workspace wins and
    // the (belt-and-suspenders) adoption lookup is never consulted.
    let recovered = recover_resume_worktree(
        Some("ws-from-session".to_string()),
        "workflow-run/run-x",
        || async { panic!("must not look up when a session was recovered") },
    )
    .await
    .expect("session recovery wins");
    assert_eq!(recovered, Some("ws-from-session".to_string()));
}

#[tokio::test]
async fn resume_adopts_nothing_when_no_record_and_no_session() {
    // Nothing to recover yet (no session, no record): the first step will mint.
    let expected = run_worktree_branch_name("run-x");
    let recovered = recover_resume_worktree(None, &expected, || async { Ok(None) })
        .await
        .expect("resume lookup ok");
    assert_eq!(recovered, None);
}

#[test]
fn run_worktree_addressing_is_run_scoped_and_deterministic() {
    // DENY-PATH (c): two runs on the SAME pinned workspace get distinct
    // worktree branches AND paths (no collision); the same run always
    // addresses the same worktree (deterministic → resume/reuse is safe).
    let pinned = "/sandbox/repo";
    let a_branch = run_worktree_branch_name("run-aaa");
    let b_branch = run_worktree_branch_name("run-bbb");
    assert_ne!(a_branch, b_branch);
    assert_eq!(a_branch, run_worktree_branch_name("run-aaa"));

    let a_path = run_worktree_target_path(pinned, "run-aaa").expect("path a");
    let b_path = run_worktree_target_path(pinned, "run-bbb").expect("path b");
    assert_ne!(a_path, b_path);
    assert_eq!(a_path, run_worktree_target_path(pinned, "run-aaa").unwrap());
    // The worktree lands as a sibling of the pinned checkout.
    assert_eq!(a_path, "/sandbox/wf-run-run-aaa");
}

#[test]
fn lane_worktree_bases_off_run_level_not_pinned() {
    // M2(a): the run-level worktree bases off the pinned checkout; a lane
    // worktree bases off the RUN-LEVEL worktree (so pre-group commits flow in).
    assert_eq!(
        worktree_base_workspace_id(NO_LANE, "ws-pinned", "ws-run-level"),
        "ws-pinned"
    );
    assert_eq!(
        worktree_base_workspace_id("fix", "ws-pinned", "ws-run-level"),
        "ws-run-level"
    );
    assert_eq!(
        worktree_base_workspace_id("docs", "ws-pinned", "ws-run-level"),
        "ws-run-level"
    );
}

#[test]
fn run_worktree_target_path_needs_a_parent() {
    // A filesystem root has no parent → no derivable worktree path (mint
    // then fails with worktree_mint_failed rather than corrupting `/`).
    assert!(run_worktree_target_path("/", "run-x").is_none());
}

#[test]
fn lane_worktree_addressing_is_distinct_per_lane() {
    // DENY-PATH (e): each lane of a run gets a DISTINCT worktree branch AND
    // path (no collision between sibling lanes, nor with the run-level
    // worktree). The run-level scope stays byte-identical to wave 2b.
    let run = "run-z";
    let pinned = "/sandbox/repo";

    // Run-level scope == the exact wave-2b strings (byte-identical for flat).
    assert_eq!(
        worktree_branch_for_scope(run, NO_LANE),
        run_worktree_branch_name(run)
    );
    assert_eq!(
        worktree_target_path_for_scope(pinned, run, NO_LANE),
        run_worktree_target_path(pinned, run)
    );

    let a_branch = worktree_branch_for_scope(run, "a");
    let b_branch = worktree_branch_for_scope(run, "b");
    let run_branch = worktree_branch_for_scope(run, NO_LANE);
    assert_eq!(a_branch, "workflow-run/run-z/a");
    assert_ne!(a_branch, b_branch);
    assert_ne!(a_branch, run_branch);
    assert_ne!(b_branch, run_branch);

    let a_path = worktree_target_path_for_scope(pinned, run, "a").unwrap();
    let b_path = worktree_target_path_for_scope(pinned, run, "b").unwrap();
    let run_path = worktree_target_path_for_scope(pinned, run, NO_LANE).unwrap();
    assert_eq!(a_path, "/sandbox/wf-run-run-z-a");
    assert_ne!(a_path, b_path);
    assert_ne!(a_path, run_path);
    assert_ne!(b_path, run_path);
    // Deterministic: the same lane always addresses the same worktree
    // (resume/adopt is safe).
    assert_eq!(a_branch, worktree_branch_for_scope(run, "a"));
    assert_eq!(a_path, worktree_target_path_for_scope(pinned, run, "a").unwrap());
}

#[test]
fn lane_worktree_adoption_is_scoped_to_the_lanes_own_branch() {
    // DENY-PATH (e), resume half: a lane adopts ONLY its own branch. A record
    // on lane a's branch is adopted when resuming lane a, but NOT when
    // resuming lane b (whose expected branch differs), so lanes never adopt
    // each other's worktrees on crash-resume.
    let run = "run-z";
    let a_branch = worktree_branch_for_scope(run, "a");
    let b_branch = worktree_branch_for_scope(run, "b");
    let found_on_a = Some(("ws-lane-a".to_string(), Some(a_branch.clone())));
    assert_eq!(
        adoptable_run_worktree(found_on_a.clone(), &a_branch),
        Some("ws-lane-a".to_string())
    );
    // Lane b's resume must not adopt lane a's worktree.
    assert_eq!(adoptable_run_worktree(found_on_a, &b_branch), None);
}

#[test]
fn run_worktree_base_ref_is_none_outside_a_repo() {
    // rev-parse fails outside a git repo → None, letting git default to the
    // source repo's HEAD rather than passing a bogus base.
    let dir = std::env::temp_dir().join(format!("wf-norepo-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    assert!(run_worktree_base_ref(&dir.to_string_lossy()).is_none());
    let _ = std::fs::remove_dir_all(&dir);
}
