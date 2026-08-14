//! The head-mismatch contract: what a failed post-restore verify leaves behind,
//! and what it deliberately does NOT do.
//!
//! On a mismatch the workspace IS active and its files ARE restored, so this is
//! a 200 with a warning, not a failure. Four things ride it and none of them is
//! a release: the refs are copied to the nested `rescue/` names (the forensic
//! anchor), the archive columns stay so the row reads visibly un-released, the
//! `UNARCHIVE_HEAD_MISMATCH` alarm is raised, and the response carries the
//! `head_mismatch` notice. The retained columns are also what ARM the retry: the
//! next unarchive re-enters the tiers instead of answering a cheerful no-op.
//!
//! The mismatch itself is forced. In production it is a torn restore or a
//! concurrent branch move — a race with no deterministic staging — so the suite
//! substitutes the observed HEAD and lets every consequence below it run for
//! real: the rescue copy is real `git update-ref`, the sweep is the real sweep,
//! and the retry is the real tier evaluation.

use super::harness::{git_stdout, head_sha, Harness};
use crate::domains::workspaces::archive::types::{
    ArchiveOptions, UnarchiveNotice, UnarchiveOptions,
};
use crate::domains::workspaces::model::WorkspaceLifecycleState;

/// Every private ref, filtered in Rust rather than by a `for-each-ref` pattern:
/// those patterns match whole path COMPONENTS, so `refs/proliferate/archive-`
/// silently matches nothing at all and the assertion under it would be vacuous.
fn refs_under(harness: &Harness, prefix: &str) -> Vec<String> {
    git_stdout(
        &harness.repo_root,
        &["for-each-ref", "--format=%(refname)", "refs/proliferate/"],
    )
    .lines()
    .filter(|refname| refname.starts_with(prefix))
    .map(str::to_string)
    .collect()
}

fn archive_refs(harness: &Harness) -> Vec<String> {
    refs_under(harness, "refs/proliferate/archive-")
}

fn rescue_refs(harness: &Harness) -> Vec<String> {
    refs_under(harness, "refs/proliferate/rescue/")
}

/// The whole contract in one pass, ending with the sweep that must not undo it.
#[tokio::test]
async fn a_failed_verify_rescues_the_refs_keeps_the_columns_and_the_sweep_skips_it() {
    let harness = Harness::new("head-mismatch");
    let path = harness.worktree_workspace("ws-1");
    // CLEAN on purpose: with nothing dirty the work tree and the index tree are
    // the SAME OID, which is exactly where a flat sha-keyed rescue name would
    // collapse three refs into two.
    let archived_sha = head_sha(&path);
    let service = harness.service();
    service
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&service, "ws-1").await;
    service.force_head_verify_mismatch_for_tests(Some("f".repeat(40)));

    let outcome = service
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("a mismatch is a warning, never a failure: the files ARE restored");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(
        outcome.notices.contains(&UnarchiveNotice::HeadMismatch),
        "the client renders the persistent fidelity warning from this notice"
    );
    let row = harness.row("ws-1");
    assert_eq!(
        row.archived_head_sha.as_deref(),
        Some(archived_sha.as_str()),
        "no release on a mismatch: the retained columns are the evidence AND the retry's arm"
    );
    let rescue = rescue_refs(&harness);
    assert_eq!(
        rescue.len(),
        3,
        "three rescue refs even when the work tree and the index tree are one OID, got {rescue:?}"
    );
    for family in ["archive-heads", "archive-worktrees", "archive-indexes"] {
        let expected = format!("refs/proliferate/rescue/ws-1-{archived_sha}/{family}");
        assert!(
            rescue.contains(&expected),
            "the nested rescue shape is load-bearing; missing {expected} in {rescue:?}"
        );
    }
    let archive_refs_before = archive_refs(&harness);
    assert_eq!(
        archive_refs_before.len(),
        3,
        "the snapshot itself is retained too"
    );

    // The refs duty releases an ACTIVE row's orphaned refs — but it skips any id
    // holding rescue names entirely, because those refs are what the user is
    // being told to look at.
    service.sweep_leftovers().await;

    assert_eq!(
        harness.row("ws-1").archived_head_sha.as_deref(),
        Some(archived_sha.as_str()),
        "the sweep must not release the columns of a row under investigation"
    );
    assert_eq!(archive_refs(&harness), archive_refs_before);
    assert_eq!(rescue_refs(&harness), rescue);
}

/// The retained columns arm the retry: an active row that still carries them is
/// NOT the idempotent no-op, it re-enters the tiers. Here the retry finds the
/// worktree intact at the archived SHA, restores in place, verifies, and
/// converges to a released row — while the rescue evidence stays put.
#[tokio::test]
async fn the_retry_after_a_mismatch_re_enters_the_tiers_and_converges() {
    let harness = Harness::new("head-mismatch-retry");
    let path = harness.worktree_workspace("ws-1");
    let archived_sha = head_sha(&path);
    let service = harness.service();
    service
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&service, "ws-1").await;
    service.force_head_verify_mismatch_for_tests(Some("f".repeat(40)));
    let mismatched = service
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("first unarchive");
    assert!(mismatched.notices.contains(&UnarchiveNotice::HeadMismatch));

    // Whatever moved HEAD is gone; the retry sees the truth.
    service.force_head_verify_mismatch_for_tests(None);
    let retried = service
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("the retry re-enters the tiers rather than answering a no-op");

    assert!(
        !retried.notices.contains(&UnarchiveNotice::HeadMismatch),
        "the verify passed this time"
    );
    let row = harness.row("ws-1");
    assert!(
        row.archived_head_sha.is_none(),
        "a verified restore releases the columns, which is what ends the retry loop"
    );
    assert_eq!(head_sha(&path), archived_sha);
    assert!(
        archive_refs(&harness).is_empty(),
        "columns first, then the refs"
    );
    assert_eq!(
        rescue_refs(&harness).len(),
        3,
        "the rescue names are exempt from the release; only purge ever clears them"
    );
}
