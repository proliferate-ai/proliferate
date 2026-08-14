//! Undo mid-phase-2, and the gate concurrency around it.
//!
//! The behaviour under test is the one users feel: pressing Undo while a 300
//! second archive script is running must be fast, deterministic, and safe. Fast
//! because the script is cancelled rather than waited out; deterministic because
//! the cancel is AWAITED rather than raced against the gate; safe because the
//! handle resolves only on confirmed process death, and the restore that follows
//! happens IN PLACE.

use std::time::Duration;

use super::harness::{head_sha, make_dirty, status_porcelain, Harness};
use crate::domains::workspaces::archive::types::{ArchiveOptions, UnarchiveOptions};
use crate::domains::workspaces::model::WorkspaceLifecycleState;

/// A script that traps TERM and keeps writing through its grace window. The
/// escalation to KILL is what has to end it, and the restore must not begin until
/// it is actually dead — an in-place restore under a still-writing script is a
/// torn restore that can then pass a HEAD-only verify.
const TERM_TRAPPING_SCRIPT: &str = r#"trap 'echo trapped >> trap-witness.txt' TERM; i=0; while [ $i -lt 600 ]; do echo $i >> script-writes.txt; sleep 0.05; i=$((i+1)); done"#;

/// Killing an archive script kills only the SCRIPT: the PTY terminal it streamed
/// into is untouched by design (R3), and its blocking reader thread would hang
/// this test's runtime at shutdown. Closed explicitly, exactly as every other
/// PTY-creating test in the house does.
async fn close_terminals(harness: &Harness, workspace_id: &str) {
    let _ = harness
        .state
        .terminal_service
        .close_all_for_workspace(workspace_id)
        .await;
}

/// Undo firing before removal starts skips removal entirely: the directory is
/// intact and exactly right, so the intact-own-worktree tier restores it in place
/// with no force-remove and no fresh `worktree add`. Which makes Undo-mid-script
/// the cheapest path in the system rather than the most expensive.
#[tokio::test]
async fn undo_mid_script_restores_in_place_with_the_ignored_state_intact() {
    let harness = Harness::new("undo-mid-script");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    // An ignored heavy-state sentinel: the thing an in-place restore preserves
    // and a remove-then-add would destroy.
    std::fs::write(path.join(".gitignore"), "heavy/\n").expect("write gitignore");
    std::fs::create_dir_all(path.join("heavy")).expect("create ignored directory");
    std::fs::write(path.join("heavy/sentinel.bin"), "expensive\n").expect("write sentinel");
    let before_head = head_sha(&path);

    harness
        .service()
        .archive(
            "ws-1",
            ArchiveOptions {
                delete_branch: false,
                archive_script: Some(TERM_TRAPPING_SCRIPT.to_string()),
            },
        )
        .await
        .expect("archive");
    assert!(
        harness.service().phase2_live("ws-1"),
        "the script window is exactly when a user presses Undo"
    );

    let started = std::time::Instant::now();
    let outcome = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("undo");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(
        started.elapsed() < Duration::from_secs(25),
        "the script must be cancelled, never waited out: took {:?}",
        started.elapsed()
    );
    assert!(
        path.join("heavy/sentinel.bin").exists(),
        "the in-place restore must leave ignored heavy state untouched"
    );
    assert_eq!(head_sha(&path), before_head);
    assert!(
        !status_porcelain(&path).is_empty(),
        "the dirt the archive captured is back"
    );
    close_terminals(&harness, "ws-1").await;
}

/// The script process is confirmed dead BEFORE the restore begins. Asserted by
/// snapshotting the script's own write counter across the restore: a script still
/// running would keep appending.
#[tokio::test]
async fn the_restore_begins_only_after_the_script_is_confirmed_dead() {
    let harness = Harness::new("undo-confirmed-dead");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);

    harness
        .service()
        .archive(
            "ws-1",
            ArchiveOptions {
                delete_branch: false,
                archive_script: Some(TERM_TRAPPING_SCRIPT.to_string()),
            },
        )
        .await
        .expect("archive");
    // Let the script actually get going, so "it stopped" is a real observation.
    tokio::time::sleep(Duration::from_millis(300)).await;

    harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("undo");
    let writes = std::fs::read_to_string(path.join("script-writes.txt")).unwrap_or_default();
    tokio::time::sleep(Duration::from_millis(400)).await;
    let writes_after = std::fs::read_to_string(path.join("script-writes.txt")).unwrap_or_default();

    assert_eq!(
        writes, writes_after,
        "a TERM-trapping script that survived the restore would produce torn content"
    );
    assert!(
        !harness.service().phase2_live("ws-1"),
        "the cancelled task deregistered"
    );
    close_terminals(&harness, "ws-1").await;
}

/// Archive → undo → re-archive → undo. Without the generation tag the first
/// task's wind-down would delete the SECOND task's token, and the second Undo
/// would cancel nothing and stall behind the second script.
#[tokio::test]
async fn a_second_undo_cancels_the_second_script() {
    let harness = Harness::new("undo-twice");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    let options = || ArchiveOptions {
        delete_branch: false,
        archive_script: Some(TERM_TRAPPING_SCRIPT.to_string()),
    };

    harness
        .service()
        .archive("ws-1", options())
        .await
        .expect("first archive");
    harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("first undo");
    harness
        .service()
        .archive("ws-1", options())
        .await
        .expect("second archive");
    assert!(harness.service().phase2_live("ws-1"));

    let started = std::time::Instant::now();
    let outcome = harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("second undo");

    assert_eq!(
        outcome.record.lifecycle_state,
        WorkspaceLifecycleState::Active
    );
    assert!(
        started.elapsed() < Duration::from_secs(25),
        "the second cancel must not stall behind the second script: took {:?}",
        started.elapsed()
    );
    assert!(!status_porcelain(&path).is_empty(), "the dirt came back");
    close_terminals(&harness, "ws-1").await;
}

/// A double-click during the phase-2 window answers 200 from the pre-gate check
/// and never reinstates the sidebar row — even though the detached task is
/// holding the gate.
#[tokio::test]
async fn a_double_click_during_phase_two_answers_two_hundred_from_the_pre_gate_check() {
    let harness = Harness::new("double-click");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);

    harness
        .service()
        .archive(
            "ws-1",
            ArchiveOptions {
                delete_branch: false,
                archive_script: Some(TERM_TRAPPING_SCRIPT.to_string()),
            },
        )
        .await
        .expect("archive");

    let second = harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("the second click must not error");

    assert_eq!(
        second.record.lifecycle_state,
        WorkspaceLifecycleState::Archived,
        "answering in-flight here would reinstate the sidebar row of a genuinely archived workspace"
    );
    // Clean up the still-running script so the harness Drop is not racing it.
    harness
        .service()
        .unarchive("ws-1", UnarchiveOptions::default())
        .await
        .expect("undo");
    close_terminals(&harness, "ws-1").await;
}

/// While the knob-free convergence cleanup runs, `phase2_live` reads true. That
/// is what keeps a double-POST on the pre-gate fast path instead of falling
/// through to a gate the cleanup holds.
#[tokio::test]
async fn the_convergence_cleanup_registers_a_token_too() {
    let harness = Harness::new("cleanup-token");
    let path = harness.worktree_workspace("ws-1");
    make_dirty(&path);
    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("archive");
    super::idempotency::settle_for(&harness.service(), "ws-1").await;

    // The re-POST answers immediately and kicks the detached cleanup.
    harness
        .service()
        .archive("ws-1", ArchiveOptions::default())
        .await
        .expect("re-archive");

    // The cleanup registered before the spawn, so liveness is observable without
    // racing the task's first await point.
    assert!(
        harness.service().phase2_live("ws-1"),
        "a cleanup that did not register would let a double-POST T7 an archived row"
    );
    super::idempotency::settle_for(&harness.service(), "ws-1").await;
    assert!(
        !path.exists(),
        "the convergence cleanup finishes the removal the first archive left behind"
    );
}
