//! Quiesce, the R4 half: the deadline trip.
//!
//! Quiesce fails in exactly one way, and this is it. If a writer is still alive
//! when the capture runs, `add -A` freezes torn mid-write content into a
//! snapshot the product calls "100% reversible" — so a deadline trip must abort
//! phase 1 and leave the workspace active and untouched, which is the one case
//! where refusing to archive IS the safe answer.
//!
//! The trip is staged with a real TERM-ignoring run plus a shortened deadline.
//! Both halves are load-bearing: the live run is what makes the kill genuinely
//! take its full escalation window (with nothing to kill the planes answer in
//! milliseconds and the deadline would never be approached), and the shortened
//! deadline is what keeps the assertion from costing eight real seconds. The
//! mechanisms below the policy — process groups, TERM → grace → KILL — are R3's
//! and are tested there.

use std::time::Duration;

use super::harness::{make_dirty, status_porcelain, Harness};
use crate::domains::workspaces::archive::types::{ArchiveError, ArchiveOptions};
use crate::domains::workspaces::model::WorkspaceLifecycleState;

/// Ignores TERM outright and writes nothing into the worktree, so the only thing
/// that ends it is the escalation to KILL and the only thing that changes on disk
/// is nothing at all.
const TERM_IGNORING_SCRIPT: &str = r#"trap '' TERM; while true; do sleep 0.05; done"#;

#[tokio::test]
async fn a_quiesce_deadline_trip_aborts_phase_one_and_leaves_the_workspace_intact() {
    let harness = Harness::new("quiesce-timeout");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let dirt_before = status_porcelain(&path);
    let service = harness.service();

    // A live run that will not die on TERM: the setup plane's kill has to walk
    // its whole escalation window before it can report.
    let setup = harness.state.workspace_setup_runtime.clone();
    let runner = tokio::spawn(async move {
        let _ = setup.run_archive_script("ws-1", TERM_IGNORING_SCRIPT).await;
    });
    tokio::time::sleep(Duration::from_millis(400)).await;
    service.set_quiesce_deadline_for_tests(Duration::from_millis(50));

    let error = service
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect_err("a workspace that cannot be quiesced must not be archived");

    assert!(
        matches!(error, ArchiveError::Failed(_)),
        "the trip is the retryable failure, not a business-rule refusal: {error:?}"
    );
    let row = harness.row("ws-1");
    assert_eq!(
        row.lifecycle_state,
        WorkspaceLifecycleState::Active,
        "phase 1 aborts before the flip, so the workspace is still the user's"
    );
    assert!(row.archived_head_sha.is_none(), "and nothing was captured");
    assert!(path.exists(), "the worktree is untouched");
    assert_eq!(
        status_porcelain(&path),
        dirt_before,
        "an aborted archive changes nothing on disk"
    );

    runner.abort();
    let _ = harness
        .state
        .terminal_service
        .kill_active_run_for_workspace("ws-1")
        .await;
    let _ = harness
        .state
        .terminal_service
        .close_all_for_workspace("ws-1")
        .await;
}
