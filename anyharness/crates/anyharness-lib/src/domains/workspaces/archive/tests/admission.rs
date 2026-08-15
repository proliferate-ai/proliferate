//! Admission guards, and the negative control the carrier ruling needs.
//!
//! `WorkspaceAccessGate` is the carrier for `archived` (R4-4): the gate already
//! sits on session start, terminal create, and every worktree mutation, so a
//! handler-only helper would have left session start and resume uncovered. The
//! handler-layer `assert_workspace_active` is a thin wrapper over the same
//! predicate for the routes that are not on the gate, which is what keeps the two
//! from drifting into guards that disagree.
//!
//! The negative control is the load-bearing half. Archiving is not deleting: an
//! archived workspace still renders its chat history, its file tree, and its git
//! state. A guard that refused reads would silently turn archive into retire.

use axum::http::StatusCode;

use super::harness::Harness;
use crate::api::http::access::{assert_workspace_active, assert_workspace_exists};
use crate::domains::workspaces::access_gate::WorkspaceAccessError;
use crate::domains::workspaces::archive::types::ArchiveOptions;

/// Every worktree mutation goes through the gate, and the gate refuses an
/// archived row with the archived error — not the mode-based `MutationBlocked`,
/// which would read as a transient cloud state to the client.
#[tokio::test]
async fn the_gate_refuses_a_mutation_against_an_archived_workspace() {
    let harness = archived_workspace("admission-mutate").await;

    let error = harness
        .state
        .workspace_access_gate
        .assert_can_mutate_for_workspace("ws-1")
        .expect_err("an archived workspace must refuse mutations");

    assert!(
        matches!(error, WorkspaceAccessError::WorkspaceArchived(id) if id == "ws-1"),
        "the refusal has to name archived, or the client cannot tell it from a blocked cloud mode"
    );
}

/// Session start is the route a handler-only helper would have missed, which is
/// why the gate carries the predicate.
#[tokio::test]
async fn the_gate_refuses_a_live_session_start_against_an_archived_workspace() {
    let harness = archived_workspace("admission-session").await;
    harness.seed_session("session-1", "ws-1");

    let error = harness
        .state
        .workspace_access_gate
        .assert_can_start_live_session("session-1")
        .expect_err("an archived workspace must refuse a live session start");

    assert!(matches!(error, WorkspaceAccessError::WorkspaceArchived(_)));
}

/// The handler-layer wrapper answers the wire contract the dialog reads: 409 with
/// `WORKSPACE_ARCHIVED`.
#[tokio::test]
async fn the_handler_wrapper_answers_four_oh_nine_workspace_archived() {
    let harness = archived_workspace("admission-http").await;

    let error = assert_workspace_active(&harness.state, "ws-1")
        .expect_err("the handler wrapper must refuse");

    assert_eq!(error.status(), StatusCode::CONFLICT);
    assert_eq!(error.code(), Some("WORKSPACE_ARCHIVED"));
}

/// The negative control for R4-4. A file or git READ against an archived
/// workspace still succeeds, because `assert_workspace_exists` asserts existence
/// and nothing else. If this ever starts failing, archive has quietly become
/// retire.
#[tokio::test]
async fn a_read_against_an_archived_workspace_still_succeeds() {
    let harness = archived_workspace("admission-read").await;

    assert!(
        assert_workspace_exists(&harness.state, "ws-1").is_ok(),
        "an archived workspace still renders its history, files, and git state"
    );
}

/// A request that queued behind archive's exclusive lease sees the FLIPPED
/// lifecycle once it acquires: the guards read the row, never a cached snapshot
/// taken before the wait.
#[tokio::test]
async fn a_request_queued_behind_the_archive_sees_the_flipped_lifecycle() {
    let harness = Harness::new("admission-queued");
    harness.worktree_workspace("ws-1");
    // Read the row BEFORE the archive, exactly as a queued request would have
    // done had it cached anything.
    assert!(assert_workspace_active(&harness.state, "ws-1").is_ok());

    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");

    let error = assert_workspace_active(&harness.state, "ws-1")
        .expect_err("the guard re-reads the row after the flip");
    assert_eq!(error.code(), Some("WORKSPACE_ARCHIVED"));
}

/// A `kind=local` archived workspace, so the guards are exercised without a
/// worktree removal racing the assertions.
async fn archived_workspace(label: &str) -> Harness {
    let harness = Harness::new(label);
    harness.local_workspace("ws-1");
    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    harness
}
