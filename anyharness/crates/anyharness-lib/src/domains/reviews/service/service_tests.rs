use rusqlite::params;

use super::*;
use crate::domains::plans::service::PlanService;
use crate::domains::plans::store::PlanStore;
use crate::persistence::Db;
use crate::sessions::links::store::SessionLinkStore;
use crate::sessions::model::{SessionEventRecord, SessionMcpBindingPolicy, SessionRecord};

use super::super::store_feedback::PendingPromptExecutionLookup;

fn seed_workspace(db: &Db) {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
             VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
            params!["workspace-1", "2026-03-25T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed workspace");
}

fn session_record(id: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".to_string(),
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

fn service_fixture() -> (ReviewService, SessionStore) {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let session_store = SessionStore::new(db.clone());
    session_store
        .insert(&session_record("parent-1"))
        .expect("insert parent");
    session_store
        .insert(&session_record("child-1"))
        .expect("insert child");
    let link_service =
        SessionLinkService::new(SessionLinkStore::new(db.clone()), session_store.clone());
    let service = ReviewService::new(
        ReviewStore::new(db.clone()),
        session_store.clone(),
        link_service,
        std::sync::Arc::new(PlanService::new(PlanStore::new(db))),
    );
    (service, session_store)
}

fn reviewer() -> ReviewPersonaInput {
    ReviewPersonaInput {
        persona_id: "skeptic".to_string(),
        label: "Plan skeptic".to_string(),
        prompt: "Find plan gaps.".to_string(),
        agent_kind: "claude".to_string(),
        model_id: Some("opus".to_string()),
        mode_id: Some("bypassPermissions".to_string()),
    }
}

fn append_session_event(
    session_store: &SessionStore,
    seq: i64,
    timestamp: &str,
    event_type: &str,
    turn_id: Option<&str>,
    payload_json: String,
) {
    session_store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "parent-1".to_string(),
            seq,
            timestamp: timestamp.to_string(),
            event_type: event_type.to_string(),
            turn_id: turn_id.map(str::to_string),
            item_id: None,
            payload_json,
        })
        .expect("append session event");
}

fn pending_prompt_removed_json(seq: i64) -> String {
    pending_prompt_removed_json_with_reason(seq, v1::PendingPromptRemovalReason::Executed)
}

fn pending_prompt_removed_json_with_reason(
    seq: i64,
    reason: v1::PendingPromptRemovalReason,
) -> String {
    serde_json::to_string(&v1::SessionEvent::PendingPromptRemoved(
        v1::PendingPromptRemovedPayload {
            seq,
            prompt_id: None,
            reason,
        },
    ))
    .expect("serialize pending prompt removed event")
}

fn review_feedback_pending_prompt_added_json(
    seq: i64,
    queued_at: &str,
    feedback_job_id: &str,
) -> String {
    serde_json::to_string(&v1::SessionEvent::PendingPromptAdded(
        v1::PendingPromptAddedPayload {
            seq,
            prompt_id: None,
            text: "Review feedback".to_string(),
            content_parts: Vec::new(),
            queued_at: queued_at.to_string(),
            prompt_provenance: Some(v1::PromptProvenance::ReviewFeedback {
                review_run_id: "run-1".to_string(),
                review_round_id: "round-1".to_string(),
                feedback_job_id: feedback_job_id.to_string(),
                label: None,
            }),
        },
    ))
    .expect("serialize pending prompt added event")
}

#[test]
fn link_reviewer_session_makes_reviewer_role_visible_immediately() {
    let (service, _session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 2,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");

    let link_id = service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");

    let visible = service
        .store()
        .find_assignment_for_reviewer_session("child-1")
        .expect("find reviewer role")
        .expect("reviewer assignment visible");
    assert_eq!(visible.id, assignment.id);
    assert_eq!(visible.session_link_id.as_deref(), Some(link_id.as_str()));
    assert_eq!(visible.status, ReviewAssignmentStatus::Reviewing);
    assert_eq!(
        visible.mode_verification_status,
        ReviewModeVerificationStatus::Pending
    );
}

#[test]
fn stop_active_run_for_parent_stops_review_and_returns_reviewer_sessions() {
    let (service, _session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 2,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");

    let reviewer_ids = service
        .stop_active_run_for_parent("parent-1")
        .expect("stop active run");

    assert_eq!(reviewer_ids, vec!["child-1".to_string()]);
    assert!(service
        .store()
        .find_active_run_for_parent("parent-1")
        .expect("active run lookup")
        .is_none());
    let stopped = service
        .store()
        .find_run(&run.id)
        .expect("find run")
        .expect("stopped run");
    assert_eq!(stopped.status, ReviewRunStatus::Stopped);
}

#[test]
fn parent_review_mcp_detection_uses_internal_review_binding_summary() {
    let (service, session_store) = service_fixture();
    let mut parent = session_record("parent-with-review-mcp");
    parent.mcp_binding_summaries_json = Some(
        serde_json::to_string(&vec![v1::SessionMcpBindingSummary {
            id: "internal:reviews".to_string(),
            server_name: "reviews".to_string(),
            display_name: Some("Reviews".to_string()),
            transport: v1::SessionMcpTransport::Http,
            outcome: v1::SessionMcpBindingOutcome::Applied,
            reason: None::<v1::SessionMcpBindingNotAppliedReason>,
        }])
        .expect("serialize summary"),
    );
    session_store.insert(&parent).expect("insert parent");

    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: parent.id,
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 1,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");

    assert!(run.parent_can_signal_revision_via_mcp);
}

#[test]
fn approved_terminal_round_creates_final_feedback_job() {
    let (service, _session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 2,
            auto_iterate: false,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");

    let job = service
        .submit_assignment_result(
            "child-1",
            true,
            "Looks ready.",
            "## Approval\n\nNo blockers.",
            "/tmp/review.md",
        )
        .expect("submit review")
        .expect("final feedback job");
    let run = service
        .store()
        .find_run(&run.id)
        .expect("find run")
        .expect("run");

    assert_eq!(run.status, ReviewRunStatus::Passed);
    assert_eq!(run.active_round_id, None);
    assert!(job.prompt_text.contains("All reviewers approved."));
    assert!(job.prompt_text.contains("continue the implementation"));
    let due = service
        .store()
        .pending_feedback_jobs("9999-01-01T00:00:00Z")
        .expect("list pending feedback");
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].id, job.id);

    service
        .store()
        .mark_feedback_job_sending(&job.id)
        .expect("mark sending")
        .expect("claim approval feedback");
    service
        .store()
        .mark_feedback_job_failed(&job.id, "prompt_send_failed", Some("network unavailable"))
        .expect("mark feedback failed");
    let run_after_failure = service
        .store()
        .find_run(&run.id)
        .expect("find run")
        .expect("run");
    let round_after_failure = service
        .store()
        .find_round(&job.review_round_id)
        .expect("find round")
        .expect("round");
    let job_after_failure = service
        .store()
        .find_feedback_job(&job.id)
        .expect("find feedback job")
        .expect("feedback job");
    assert_eq!(run_after_failure.status, ReviewRunStatus::Passed);
    assert_eq!(
        round_after_failure.status,
        ReviewRoundStatus::FeedbackPending
    );
    assert_eq!(job_after_failure.state, ReviewFeedbackJobState::Failed);
}

#[test]
fn final_round_revision_ready_closes_run_instead_of_error() {
    let (service, _session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 1,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");
    let job = service
        .submit_assignment_result(
            "child-1",
            false,
            "Needs changes.",
            "## Findings\n\nMissing concrete checks.",
            "/tmp/review.md",
        )
        .expect("submit review")
        .expect("feedback job");
    service
        .store()
        .mark_feedback_job_sent(&job.id, None, Some("feedback-turn-1"), None)
        .expect("mark feedback sent");

    let run = service
        .start_next_round_records(&run.id, None, None)
        .expect("finalize at max rounds");

    assert_eq!(run.status, ReviewRunStatus::Stopped);
    assert_eq!(run.active_round_id, None);
    assert_eq!(run.failure_reason.as_deref(), Some("max_rounds_reached"));
}

#[test]
fn requested_changes_stay_feedback_ready_until_feedback_turn_is_recorded() {
    let (service, _session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 2,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");
    let job = service
        .submit_assignment_result(
            "child-1",
            false,
            "Needs changes.",
            "## Findings\n\nMissing concrete checks.",
            "/tmp/review.md",
        )
        .expect("submit review")
        .expect("feedback job");

    let run_before_delivery = service
        .store()
        .find_run(&run.id)
        .expect("find run")
        .expect("run");
    assert_eq!(run_before_delivery.status, ReviewRunStatus::FeedbackReady);

    service
        .store()
        .mark_feedback_job_sending(&job.id)
        .expect("mark sending")
        .expect("claimed sending job");
    let run_while_sending = service
        .store()
        .find_run(&run.id)
        .expect("find run")
        .expect("run");
    assert_eq!(run_while_sending.status, ReviewRunStatus::FeedbackReady);

    service
        .store()
        .mark_feedback_job_sent(&job.id, None, Some("feedback-turn-1"), None)
        .expect("mark sent");
    let run_after_delivery = service
        .store()
        .find_run(&run.id)
        .expect("find run")
        .expect("run");
    assert_eq!(run_after_delivery.status, ReviewRunStatus::ParentRevising);
}

#[test]
fn manual_feedback_jobs_are_not_due_until_delivery_has_been_attempted() {
    let (service, _session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 2,
            auto_iterate: false,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");
    let job = service
        .submit_assignment_result(
            "child-1",
            false,
            "Needs changes.",
            "## Findings\n\nMissing concrete checks.",
            "/tmp/review.md",
        )
        .expect("submit review")
        .expect("feedback job");

    let due_before_manual_send = service
        .store()
        .pending_feedback_jobs("9999-01-01T00:00:00Z")
        .expect("list pending feedback");
    assert!(due_before_manual_send.is_empty());

    service
        .store()
        .mark_feedback_job_sending(&job.id)
        .expect("mark sending")
        .expect("claimed sending job");
    service
        .store()
        .mark_feedback_job_retry(
            &job.id,
            "send_failed",
            Some("temporary failure"),
            "2000-01-01T00:00:00Z",
        )
        .expect("mark retry");

    let due_after_manual_attempt = service
        .store()
        .pending_feedback_jobs("9999-01-01T00:00:00Z")
        .expect("list pending feedback");
    assert_eq!(due_after_manual_attempt.len(), 1);
    assert_eq!(due_after_manual_attempt[0].id, job.id);
}

#[test]
fn reviewer_session_can_be_reused_after_terminal_assignment() {
    let (service, _session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 2,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    let link_id = service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");
    let job = service
        .submit_assignment_result(
            "child-1",
            false,
            "Needs changes.",
            "## Findings\n\nMissing concrete checks.",
            "/tmp/review.md",
        )
        .expect("submit review")
        .expect("feedback job");
    service
        .store()
        .mark_feedback_job_sent(&job.id, None, Some("feedback-turn-1"), None)
        .expect("mark feedback sent");
    service
        .mark_parent_feedback_turn_finished("parent-1", "feedback-turn-1")
        .expect("mark parent turn finished");

    let run = service
        .start_next_round_records(&run.id, None, None)
        .expect("start next round");
    let next_round_id = run.active_round_id.as_deref().expect("active round");
    let next_assignment = service
        .store()
        .list_assignments_for_round(next_round_id)
        .expect("list next assignments")
        .pop()
        .expect("next assignment");

    let launched = service
        .store()
        .update_assignment_launched(
            &next_assignment.id,
            "child-1",
            &link_id,
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("reuse reviewer session");
    assert!(launched);
    let visible = service
        .store()
        .find_assignment_for_reviewer_session("child-1")
        .expect("find active reviewer assignment")
        .expect("active reviewer assignment");

    assert_eq!(visible.id, next_assignment.id);
}

#[test]
fn retry_launch_failure_restores_retryable_assignment_after_system_failure() {
    let (service, _session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 2,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");
    service
        .store()
        .mark_assignment_retryable_failed(
            &assignment.id,
            "child-1",
            "provider_rate_limit",
            Some("original provider limit"),
        )
        .expect("mark retryable")
        .expect("retryable assignment");

    let prepared = service
        .store()
        .prepare_assignment_retry(
            &run.id,
            &assignment.id,
            Some("claude-opus-4-6"),
            "2026-04-28T01:00:00Z",
        )
        .expect("prepare retry")
        .expect("prepared assignment");
    assert_eq!(prepared.status, ReviewAssignmentStatus::Launching);
    service
        .store()
        .mark_assignment_system_failed(
            &assignment.id,
            "reviewer_start_failed",
            Some("start failed"),
        )
        .expect("mark system failed");

    let restored = service
        .store()
        .restore_assignment_retryable_after_retry_launch_failed(
            &run.id,
            &assignment.id,
            Some("Retry launch failed: start failed"),
        )
        .expect("restore retryable");

    assert!(restored);
    let updated = service
        .store()
        .find_assignment(&assignment.id)
        .expect("find assignment")
        .expect("assignment");
    assert_eq!(updated.status, ReviewAssignmentStatus::RetryableFailed);
    assert_eq!(
        updated.failure_reason.as_deref(),
        Some("provider_rate_limit")
    );
    assert_eq!(
        updated.failure_detail.as_deref(),
        Some("Retry launch failed: start failed")
    );
    assert_eq!(updated.model_id.as_deref(), Some("claude-opus-4-6"));
    let completion = service
        .try_complete_round(&updated.review_round_id)
        .expect("try complete round");
    assert!(completion.is_none());
    let run_after_restore = service
        .store()
        .find_run(&run.id)
        .expect("find run")
        .expect("run");
    assert_eq!(run_after_restore.status, ReviewRunStatus::Reviewing);
}

#[test]
fn retry_prompt_failure_restores_retryable_assignment_and_blocks_late_submission() {
    let (service, session_store) = service_fixture();
    session_store
        .insert(&session_record("child-retry-1"))
        .expect("insert retry child");
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 2,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");
    service
        .store()
        .mark_assignment_retryable_failed(
            &assignment.id,
            "child-1",
            "provider_rate_limit",
            Some("original provider limit"),
        )
        .expect("mark retryable")
        .expect("retryable assignment");
    service
        .store()
        .prepare_assignment_retry(
            &run.id,
            &assignment.id,
            Some("claude-opus-4-6"),
            "2026-04-28T01:00:00Z",
        )
        .expect("prepare retry")
        .expect("prepared assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-retry-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link retry reviewer");

    let restored = service
        .store()
        .restore_assignment_retryable_after_retry_launch_failed(
            &run.id,
            &assignment.id,
            Some("Retry launch failed: prompt rejected"),
        )
        .expect("restore retryable");

    assert!(restored);
    let updated = service
        .store()
        .find_assignment(&assignment.id)
        .expect("find assignment")
        .expect("assignment");
    assert_eq!(updated.status, ReviewAssignmentStatus::RetryableFailed);
    assert_eq!(
        updated.reviewer_session_id.as_deref(),
        Some("child-retry-1")
    );
    assert_eq!(
        updated.failure_reason.as_deref(),
        Some("provider_rate_limit")
    );

    let late_submission = service
        .submit_assignment_result(
            "child-retry-1",
            true,
            "Looks ready.",
            "## Approval\n\nNo blockers.",
            "/tmp/review.md",
        )
        .expect_err("retryable failed assignment must not accept submissions");
    assert!(matches!(
        late_submission,
        ReviewError::AssignmentNotFound(_)
    ));
}

#[test]
fn retry_launch_update_does_not_resurrect_stopped_assignment() {
    let (service, session_store) = service_fixture();
    session_store
        .insert(&session_record("child-retry-1"))
        .expect("insert retry child");
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 2,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");
    service
        .store()
        .mark_assignment_retryable_failed(
            &assignment.id,
            "child-1",
            "provider_rate_limit",
            Some("original provider limit"),
        )
        .expect("mark retryable")
        .expect("retryable assignment");
    service
        .store()
        .prepare_assignment_retry(
            &run.id,
            &assignment.id,
            Some("claude-opus-4-6"),
            "2026-04-28T01:00:00Z",
        )
        .expect("prepare retry")
        .expect("prepared assignment");

    let reviewer_ids = service.stop_run(&run.id).expect("stop run");
    assert!(reviewer_ids.is_empty());

    let link_after_stop = service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-retry-1",
            Some("Plan skeptic".to_string()),
            Some("bypassPermissions"),
            ReviewModeVerificationStatus::Verified,
        )
        .expect_err("stopped review must reject retry reviewer link");
    assert!(matches!(link_after_stop, ReviewError::RetryNotAllowed));
    let leaked_link = service
        .link_service
        .find_link_by_relation(
            SessionLinkRelation::ReviewAgent,
            "parent-1",
            "child-retry-1",
        )
        .expect("find retry link");
    assert!(leaked_link.is_none());

    let launched = service
        .store()
        .update_assignment_launched(
            &assignment.id,
            "child-retry-1",
            "retry-link-1",
            Some("bypassPermissions"),
            ReviewModeVerificationStatus::Verified,
        )
        .expect("attempt launch update after stop");
    service
        .store()
        .mark_assignment_system_failed(
            &assignment.id,
            "reviewer_start_failed",
            Some("late start failure"),
        )
        .expect("late system failure marker");

    assert!(!launched);
    let updated = service
        .store()
        .find_assignment(&assignment.id)
        .expect("find assignment")
        .expect("assignment");
    assert_eq!(updated.status, ReviewAssignmentStatus::Cancelled);
    assert_eq!(updated.reviewer_session_id, None);
    assert_eq!(updated.session_link_id, None);
    let stopped = service
        .store()
        .find_run(&run.id)
        .expect("find run")
        .expect("run");
    assert_eq!(stopped.status, ReviewRunStatus::Stopped);

    service
        .delete_unlaunched_reviewer_session("child-retry-1")
        .expect("delete unlaunched reviewer");
    let deleted_child = session_store
        .find_by_id("child-retry-1")
        .expect("find deleted child");
    assert!(deleted_child.is_none());
}

#[test]
fn auto_feedback_turn_claim_starts_next_round_once() {
    let (service, _session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 2,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");
    let job = service
        .submit_assignment_result(
            "child-1",
            false,
            "Needs changes.",
            "## Findings\n\nMissing concrete checks.",
            "/tmp/review.md",
        )
        .expect("submit review")
        .expect("feedback job");
    service
        .store()
        .mark_feedback_job_sent(&job.id, None, Some("feedback-turn-1"), None)
        .expect("mark feedback sent");
    service
        .mark_parent_feedback_turn_finished("parent-1", "feedback-turn-1")
        .expect("mark parent turn finished");

    let (first, first_started) = service
        .start_next_round_records_after_feedback_turn(&run.id, "feedback-turn-1", None, None)
        .expect("first auto start");
    let (second, second_started) = service
        .start_next_round_records_after_feedback_turn(&run.id, "feedback-turn-1", None, None)
        .expect("second auto start");
    let rounds = service
        .store()
        .list_rounds_for_run(&run.id)
        .expect("list rounds");

    assert!(first_started);
    assert!(!second_started);
    assert_eq!(first.current_round_number, 2);
    assert_eq!(second.current_round_number, 2);
    assert_eq!(rounds.len(), 2);
}

#[test]
fn stale_feedback_turn_cannot_advance_later_active_round() {
    let (service, _session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 3,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    let link_id = service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");
    let first_job = service
        .submit_assignment_result(
            "child-1",
            false,
            "Needs changes.",
            "## Findings\n\nMissing concrete checks.",
            "/tmp/review.md",
        )
        .expect("submit first review")
        .expect("first feedback job");
    service
        .store()
        .mark_feedback_job_sent(&first_job.id, None, Some("feedback-turn-1"), None)
        .expect("mark first feedback sent");
    service
        .mark_parent_feedback_turn_finished("parent-1", "feedback-turn-1")
        .expect("mark first feedback turn finished")
        .expect("first feedback turn matched");
    let (second_round_run, second_started) = service
        .start_next_round_records_after_feedback_turn(&run.id, "feedback-turn-1", None, None)
        .expect("start second round");
    assert!(second_started);
    let second_round_id = second_round_run
        .active_round_id
        .as_deref()
        .expect("second active round");
    let second_assignment = service
        .store()
        .list_assignments_for_round(second_round_id)
        .expect("list second assignments")
        .pop()
        .expect("second assignment");
    assert!(service
        .store()
        .update_assignment_launched(
            &second_assignment.id,
            "child-1",
            &link_id,
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("launch second assignment"));
    let second_job = service
        .submit_assignment_result(
            "child-1",
            false,
            "Still needs changes.",
            "## Findings\n\nStill missing concrete checks.",
            "/tmp/review-round-2.md",
        )
        .expect("submit second review")
        .expect("second feedback job");
    service
        .store()
        .mark_feedback_job_sent(&second_job.id, None, Some("feedback-turn-2"), None)
        .expect("mark second feedback sent");

    let stale_match = service
        .mark_parent_feedback_turn_finished("parent-1", "feedback-turn-1")
        .expect("try stale feedback turn");
    assert!(stale_match.is_none());

    let (stale_run, stale_started) = service
        .start_next_round_records_after_feedback_turn(&run.id, "feedback-turn-1", None, None)
        .expect("try stale auto start");
    assert!(!stale_started);
    assert_eq!(stale_run.current_round_number, 2);

    service
        .mark_parent_feedback_turn_finished("parent-1", "feedback-turn-2")
        .expect("mark current feedback turn finished")
        .expect("current feedback turn matched");
    let (third_round_run, third_started) = service
        .start_next_round_records_after_feedback_turn(&run.id, "feedback-turn-2", None, None)
        .expect("start third round");
    assert!(third_started);
    assert_eq!(third_round_run.current_round_number, 3);
}

#[test]
fn pending_prompt_execution_lookup_uses_feedback_provenance_for_reused_seq() {
    let (service, session_store) = service_fixture();
    append_session_event(
        &session_store,
        1,
        "2026-04-29T00:00:01+00:00",
        "pending_prompt_added",
        None,
        review_feedback_pending_prompt_added_json(1, "2026-04-29T00:00:01+00:00", "old-job"),
    );
    append_session_event(
        &session_store,
        2,
        "2026-04-29T00:00:02+00:00",
        "turn_started",
        Some("old-turn"),
        r#"{"type":"turn_started"}"#.to_string(),
    );
    append_session_event(
        &session_store,
        3,
        "2026-04-29T00:00:03+00:00",
        "pending_prompt_removed",
        None,
        pending_prompt_removed_json(1),
    );
    append_session_event(
        &session_store,
        4,
        "2026-04-29T00:00:04+00:00",
        "pending_prompt_added",
        None,
        review_feedback_pending_prompt_added_json(1, "2026-04-29T00:00:04+00:00", "feedback-job-1"),
    );
    append_session_event(
        &session_store,
        5,
        "2026-04-29T00:00:05+00:00",
        "turn_started",
        Some("new-turn"),
        r#"{"type":"turn_started"}"#.to_string(),
    );
    append_session_event(
        &session_store,
        6,
        "2026-04-29T00:00:06+00:00",
        "pending_prompt_removed",
        None,
        pending_prompt_removed_json(1),
    );

    let lookup = service
        .store()
        .find_pending_prompt_execution("parent-1", 1, "feedback-job-1")
        .expect("find pending prompt execution");

    assert_eq!(
        lookup,
        PendingPromptExecutionLookup::Executed {
            turn_id: "new-turn".to_string(),
            executed_at: "2026-04-29T00:00:06+00:00".to_string(),
        },
    );
}

#[test]
fn deleted_queued_feedback_prompt_is_reset_for_retry_without_seq_misattribution() {
    let (service, session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 2,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");
    let job = service
        .submit_assignment_result(
            "child-1",
            false,
            "Needs changes.",
            "## Findings\n\nMissing concrete checks.",
            "/tmp/review.md",
        )
        .expect("submit review")
        .expect("feedback job");
    service
        .store()
        .mark_feedback_job_sending(&job.id)
        .expect("mark sending")
        .expect("claimed sending job");
    service
        .store()
        .mark_feedback_job_queued(&job.id, Some(1))
        .expect("mark queued")
        .expect("queued feedback job");

    append_session_event(
        &session_store,
        1,
        "2026-04-29T00:00:01+00:00",
        "pending_prompt_added",
        None,
        review_feedback_pending_prompt_added_json(1, "2026-04-29T00:00:01+00:00", &job.id),
    );
    append_session_event(
        &session_store,
        2,
        "2026-04-29T00:00:02+00:00",
        "pending_prompt_removed",
        None,
        pending_prompt_removed_json_with_reason(1, v1::PendingPromptRemovalReason::Deleted),
    );
    append_session_event(
        &session_store,
        3,
        "2026-04-29T00:00:03+00:00",
        "pending_prompt_added",
        None,
        review_feedback_pending_prompt_added_json(1, "2026-04-29T00:00:03+00:00", "other-job"),
    );
    append_session_event(
        &session_store,
        4,
        "2026-04-29T00:00:04+00:00",
        "turn_started",
        Some("unrelated-turn"),
        r#"{"type":"turn_started"}"#.to_string(),
    );
    append_session_event(
        &session_store,
        5,
        "2026-04-29T00:00:05+00:00",
        "pending_prompt_removed",
        None,
        pending_prompt_removed_json(1),
    );

    let lookup = service
        .store()
        .find_pending_prompt_execution("parent-1", 1, &job.id)
        .expect("find pending prompt execution");

    assert_eq!(
        lookup,
        PendingPromptExecutionLookup::Removed {
            reason: v1::PendingPromptRemovalReason::Deleted,
        },
    );

    let reset_job = service
        .store()
        .reset_queued_feedback_job_for_retry(
            &job.id,
            1,
            "queued_prompt_removed",
            Some("deleted before execution"),
        )
        .expect("reset queued feedback job")
        .expect("reset job");
    assert_eq!(reset_job.state, ReviewFeedbackJobState::Pending);
    assert!(reset_job.sent_prompt_seq.is_none());
    assert!(reset_job.feedback_turn_id.is_none());
    assert_eq!(
        reset_job.failure_reason.as_deref(),
        Some("queued_prompt_removed")
    );

    let due = service
        .store()
        .pending_feedback_jobs("9999-01-01T00:00:00Z")
        .expect("list pending feedback jobs");
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].id, job.id);

    service
        .store()
        .mark_feedback_job_sending(&job.id)
        .expect("mark retry sending")
        .expect("claimed retry job");
    service
        .store()
        .mark_feedback_job_queued(&job.id, Some(1))
        .expect("mark retry queued")
        .expect("queued retry feedback job");
    append_session_event(
        &session_store,
        6,
        "2026-04-29T00:00:06+00:00",
        "pending_prompt_added",
        None,
        review_feedback_pending_prompt_added_json(1, "2026-04-29T00:00:06+00:00", &job.id),
    );
    append_session_event(
        &session_store,
        7,
        "2026-04-29T00:00:07+00:00",
        "turn_started",
        Some("retry-turn"),
        r#"{"type":"turn_started"}"#.to_string(),
    );
    append_session_event(
        &session_store,
        8,
        "2026-04-29T00:00:08+00:00",
        "pending_prompt_removed",
        None,
        pending_prompt_removed_json(1),
    );

    let retry_lookup = service
        .store()
        .find_pending_prompt_execution("parent-1", 1, &job.id)
        .expect("find retry pending prompt execution");

    assert_eq!(
        retry_lookup,
        PendingPromptExecutionLookup::Executed {
            turn_id: "retry-turn".to_string(),
            executed_at: "2026-04-29T00:00:08+00:00".to_string(),
        },
    );

    service
        .store()
        .mark_feedback_job_sent(
            &job.id,
            Some(1),
            Some("retry-turn"),
            Some("2026-04-29T00:00:08+00:00"),
        )
        .expect("mark retry sent")
        .expect("sent retry job");
    let sent_job = service
        .store()
        .find_feedback_job(&job.id)
        .expect("find sent feedback job")
        .expect("feedback job");
    assert_eq!(sent_job.state, ReviewFeedbackJobState::Sent);
    assert_eq!(sent_job.sent_prompt_seq, Some(1));
    assert_eq!(sent_job.feedback_turn_id.as_deref(), Some("retry-turn"));
}

#[test]
fn final_feedback_turn_stops_run_when_max_rounds_reached() {
    let (service, _session_store) = service_fixture();
    let run = service
        .start_review(StartReviewInput {
            workspace_id: "workspace-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            kind: ReviewKind::Code,
            title: "Review current changes".to_string(),
            target_plan: None,
            target_code_manifest: None,
            max_rounds: 1,
            auto_iterate: true,
            reviewers: vec![reviewer()],
        })
        .expect("start review");
    let assignment = service
        .store()
        .list_assignments_for_run(&run.id)
        .expect("list assignments")
        .pop()
        .expect("assignment");
    service
        .link_reviewer_session(
            &run.id,
            &assignment.id,
            "parent-1",
            "child-1",
            Some("Plan skeptic".to_string()),
            None,
            ReviewModeVerificationStatus::Pending,
        )
        .expect("link reviewer");
    let job = service
        .submit_assignment_result(
            "child-1",
            false,
            "Needs changes.",
            "## Findings\n\nMissing concrete checks.",
            "/tmp/review.md",
        )
        .expect("submit review")
        .expect("feedback job");
    service
        .store()
        .mark_feedback_job_sent(&job.id, None, Some("feedback-turn-1"), None)
        .expect("mark feedback sent");

    service
        .mark_parent_feedback_turn_finished("parent-1", "feedback-turn-1")
        .expect("mark parent turn finished");
    let run = service
        .store()
        .find_run(&run.id)
        .expect("find run")
        .expect("run");

    assert_eq!(run.status, ReviewRunStatus::Stopped);
    assert_eq!(run.active_round_id, None);
    assert_eq!(run.failure_reason.as_deref(), Some("max_rounds_reached"));
}
