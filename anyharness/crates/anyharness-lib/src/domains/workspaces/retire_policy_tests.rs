//! Pure policy tests for the retire state machine: hand-built facts, no DB, no
//! AppState, no clock. Every branch of every decision fn, plus the two
//! asymmetries between the retire rule (copies A/B) and the retry rule (copy C)
//! that the refactor preserved verbatim.

use super::*;

fn facts(
    lifecycle_state: WorkspaceLifecycleState,
    cleanup_state: WorkspaceCleanupState,
    cleanup_operation: Option<WorkspaceCleanupOperation>,
) -> RetireStateFacts {
    RetireStateFacts {
        lifecycle_state,
        cleanup_state,
        cleanup_operation,
        cleanup_error_message: None,
    }
}

// ── decide_retire_admission (copies A and B, as one rule) ─────────────────────

#[test]
fn an_active_workspace_proceeds_to_the_retire_pipeline() {
    for cleanup_state in [
        WorkspaceCleanupState::None,
        WorkspaceCleanupState::Pending,
        WorkspaceCleanupState::Complete,
        WorkspaceCleanupState::Failed,
    ] {
        assert_eq!(
            decide_retire_admission(&facts(
                WorkspaceLifecycleState::Active,
                cleanup_state,
                None
            )),
            RetireAdmission::Proceed,
            "an ACTIVE workspace proceeds regardless of cleanup state ({cleanup_state:?})"
        );
    }
}

#[test]
fn an_active_workspace_proceeds_even_under_a_purge_cleanup_operation() {
    // The purge check is reached only for RETIRED records: lifecycle is tested
    // first. An active record with a stale purge operation still proceeds.
    assert_eq!(
        decide_retire_admission(&facts(
            WorkspaceLifecycleState::Active,
            WorkspaceCleanupState::Failed,
            Some(WorkspaceCleanupOperation::Purge),
        )),
        RetireAdmission::Proceed
    );
}

#[test]
fn a_retired_purge_tombstone_refuses_retire_and_points_at_purge_retry() {
    for cleanup_state in [
        WorkspaceCleanupState::None,
        WorkspaceCleanupState::Pending,
        WorkspaceCleanupState::Complete,
        WorkspaceCleanupState::Failed,
    ] {
        assert_eq!(
            decide_retire_admission(&facts(
                WorkspaceLifecycleState::Retired,
                cleanup_state,
                Some(WorkspaceCleanupOperation::Purge),
            )),
            RetireAdmission::PurgeCleanupInProgress,
            "a retired PURGE tombstone is refused in every cleanup state ({cleanup_state:?})"
        );
    }
}

#[test]
fn a_retired_workspace_with_complete_cleanup_is_already_retired_and_succeeded() {
    assert_eq!(
        decide_retire_admission(&facts(
            WorkspaceLifecycleState::Retired,
            WorkspaceCleanupState::Complete,
            Some(WorkspaceCleanupOperation::Retire),
        )),
        RetireAdmission::AlreadyRetired {
            cleanup_succeeded: true,
            cleanup_message: None,
        }
    );
}

#[test]
fn a_retired_workspace_with_pending_cleanup_is_already_retired_but_not_succeeded() {
    assert_eq!(
        decide_retire_admission(&facts(
            WorkspaceLifecycleState::Retired,
            WorkspaceCleanupState::Pending,
            Some(WorkspaceCleanupOperation::Retire),
        )),
        RetireAdmission::AlreadyRetired {
            cleanup_succeeded: false,
            cleanup_message: Some("retired workspace cleanup is still pending".to_string()),
        }
    );
}

#[test]
fn a_retired_workspace_with_failed_cleanup_reports_the_recorded_error() {
    let mut with_error = facts(
        WorkspaceLifecycleState::Retired,
        WorkspaceCleanupState::Failed,
        Some(WorkspaceCleanupOperation::Retire),
    );
    with_error.cleanup_error_message = Some("git worktree remove refused".to_string());
    assert_eq!(
        decide_retire_admission(&with_error),
        RetireAdmission::AlreadyRetired {
            cleanup_succeeded: false,
            cleanup_message: Some("git worktree remove refused".to_string()),
        }
    );
}

#[test]
fn a_failed_cleanup_without_a_recorded_error_falls_back_to_a_generic_message() {
    assert_eq!(
        decide_retire_admission(&facts(
            WorkspaceLifecycleState::Retired,
            WorkspaceCleanupState::Failed,
            Some(WorkspaceCleanupOperation::Retire),
        )),
        RetireAdmission::AlreadyRetired {
            cleanup_succeeded: false,
            cleanup_message: Some("retired workspace cleanup failed".to_string()),
        }
    );
}

#[test]
fn a_retired_workspace_with_no_cleanup_operation_is_already_retired_not_blocked() {
    // `cleanup_operation: None` is not a purge tombstone, so it takes the
    // idempotent AlreadyRetired path — not the Blocked one.
    let admission = decide_retire_admission(&facts(
        WorkspaceLifecycleState::Retired,
        WorkspaceCleanupState::None,
        None,
    ));
    assert_eq!(
        admission,
        RetireAdmission::AlreadyRetired {
            cleanup_succeeded: false,
            cleanup_message: Some(
                "retired workspace cleanup is not complete: none".to_string()
            ),
        }
    );
}

// ── decide_retry_admission (copy C) ──────────────────────────────────────────

#[test]
fn cleanup_retry_is_available_for_a_retired_retire_tombstone_mid_cleanup() {
    for cleanup_state in [WorkspaceCleanupState::Pending, WorkspaceCleanupState::Failed] {
        for operation in [None, Some(WorkspaceCleanupOperation::Retire)] {
            assert_eq!(
                decide_retry_admission(&facts(
                    WorkspaceLifecycleState::Retired,
                    cleanup_state,
                    operation
                )),
                RetryAdmission::Proceed,
                "retry is available for retired + {cleanup_state:?} + {operation:?}"
            );
        }
    }
}

#[test]
fn cleanup_retry_refuses_an_active_workspace() {
    assert_eq!(
        decide_retry_admission(&facts(
            WorkspaceLifecycleState::Active,
            WorkspaceCleanupState::Failed,
            Some(WorkspaceCleanupOperation::Retire),
        )),
        RetryAdmission::Unavailable
    );
}

#[test]
fn cleanup_retry_refuses_a_purge_tombstone() {
    assert_eq!(
        decide_retry_admission(&facts(
            WorkspaceLifecycleState::Retired,
            WorkspaceCleanupState::Failed,
            Some(WorkspaceCleanupOperation::Purge),
        )),
        RetryAdmission::Unavailable
    );
}

#[test]
fn cleanup_retry_refuses_a_non_resumable_cleanup_state() {
    for cleanup_state in [WorkspaceCleanupState::Complete, WorkspaceCleanupState::None] {
        assert_eq!(
            decide_retry_admission(&facts(
                WorkspaceLifecycleState::Retired,
                cleanup_state,
                Some(WorkspaceCleanupOperation::Retire),
            )),
            RetryAdmission::Unavailable,
            "retry refuses retired + {cleanup_state:?}: nothing to resume"
        );
    }
}

// ── preserved divergence between the retire rule and the retry rule ──────────
//
// The two rules answer different questions, so they disagree on two record
// shapes. Both disagreements are pre-refactor behaviour, preserved verbatim.

#[test]
fn retire_and_retry_disagree_about_a_retired_workspace_with_complete_cleanup() {
    let record = facts(
        WorkspaceLifecycleState::Retired,
        WorkspaceCleanupState::Complete,
        Some(WorkspaceCleanupOperation::Retire),
    );
    // Retire: idempotent success. Retry: nothing left to resume.
    assert!(matches!(
        decide_retire_admission(&record),
        RetireAdmission::AlreadyRetired {
            cleanup_succeeded: true,
            ..
        }
    ));
    assert_eq!(decide_retry_admission(&record), RetryAdmission::Unavailable);
}

#[test]
fn retire_and_retry_disagree_about_a_retired_workspace_with_no_cleanup_state() {
    // FINDING (flagged for a ruling, behaviour preserved): retire reports this
    // record as "cleanup is not complete", but retry refuses to resume it, so
    // the caller is told cleanup is unfinished and simultaneously that no retry
    // is available. Neither rule was changed by the refactor.
    let record = facts(
        WorkspaceLifecycleState::Retired,
        WorkspaceCleanupState::None,
        Some(WorkspaceCleanupOperation::Retire),
    );
    assert!(matches!(
        decide_retire_admission(&record),
        RetireAdmission::AlreadyRetired {
            cleanup_succeeded: false,
            cleanup_message: Some(_),
        }
    ));
    assert_eq!(decide_retry_admission(&record), RetryAdmission::Unavailable);
}

// ── retire_preflight_mode ────────────────────────────────────────────────────

#[test]
fn preflight_mode_follows_the_retry_rule_exactly() {
    // The handler used to restate copy C's three-term predicate here. Same
    // question, so the mode is defined in terms of it: assert they never part.
    for lifecycle_state in [WorkspaceLifecycleState::Active, WorkspaceLifecycleState::Retired] {
        for cleanup_state in [
            WorkspaceCleanupState::None,
            WorkspaceCleanupState::Pending,
            WorkspaceCleanupState::Complete,
            WorkspaceCleanupState::Failed,
        ] {
            for operation in [
                None,
                Some(WorkspaceCleanupOperation::Retire),
                Some(WorkspaceCleanupOperation::Purge),
            ] {
                let record = facts(lifecycle_state, cleanup_state, operation);
                let expected = match decide_retry_admission(&record) {
                    RetryAdmission::Proceed => RetirePreflightMode::RetiredCleanupRetry,
                    RetryAdmission::Unavailable => RetirePreflightMode::ActiveRetire,
                };
                assert_eq!(
                    retire_preflight_mode(&record),
                    expected,
                    "mode must track the retry rule for {lifecycle_state:?}/{cleanup_state:?}/{operation:?}"
                );
            }
        }
    }
}

#[test]
fn preflight_mode_is_retired_cleanup_retry_only_for_a_resumable_retire_tombstone() {
    assert_eq!(
        retire_preflight_mode(&facts(
            WorkspaceLifecycleState::Retired,
            WorkspaceCleanupState::Failed,
            Some(WorkspaceCleanupOperation::Retire),
        )),
        RetirePreflightMode::RetiredCleanupRetry
    );
    assert_eq!(
        retire_preflight_mode(&facts(
            WorkspaceLifecycleState::Active,
            WorkspaceCleanupState::None,
            None
        )),
        RetirePreflightMode::ActiveRetire
    );
    // A purge tombstone is evaluated as an ACTIVE retire, not a retry.
    assert_eq!(
        retire_preflight_mode(&facts(
            WorkspaceLifecycleState::Retired,
            WorkspaceCleanupState::Failed,
            Some(WorkspaceCleanupOperation::Purge),
        )),
        RetirePreflightMode::ActiveRetire
    );
}

// ── decide_cleanup_outcome (the fourth, unnamed copy) ────────────────────────

#[test]
fn a_successful_cleanup_completes_the_tombstone_without_a_failure_timestamp() {
    assert_eq!(
        decide_cleanup_outcome(true),
        CleanupDecision {
            outcome: RetireOutcome::Retired,
            cleanup_state: WorkspaceCleanupState::Complete,
            cleanup_succeeded: true,
            records_failure_timestamp: false,
        }
    );
}

#[test]
fn a_failed_cleanup_fails_the_tombstone_and_asks_for_a_failure_timestamp() {
    assert_eq!(
        decide_cleanup_outcome(false),
        CleanupDecision {
            outcome: RetireOutcome::CleanupFailed,
            cleanup_state: WorkspaceCleanupState::Failed,
            cleanup_succeeded: false,
            records_failure_timestamp: true,
        }
    );
}

// ── facts extraction ─────────────────────────────────────────────────────────

#[test]
fn facts_carry_exactly_the_record_fields_the_state_machine_reads() {
    let mut record = crate::domains::workspaces::model::test_workspace_record(
        crate::domains::workspaces::model::WorkspaceKind::Worktree,
        "/tmp/anyharness-retire-policy-facts",
    );
    record.lifecycle_state = WorkspaceLifecycleState::Retired;
    record.cleanup_state = WorkspaceCleanupState::Failed;
    record.cleanup_operation = Some(WorkspaceCleanupOperation::Retire);
    record.cleanup_error_message = Some("boom".to_string());

    assert_eq!(
        RetireStateFacts::of(&record),
        RetireStateFacts {
            lifecycle_state: WorkspaceLifecycleState::Retired,
            cleanup_state: WorkspaceCleanupState::Failed,
            cleanup_operation: Some(WorkspaceCleanupOperation::Retire),
            cleanup_error_message: Some("boom".to_string()),
        }
    );
}
