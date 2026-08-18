use super::*;
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::model::{
    PendingPromptRecord, SessionEventRecord, SessionMcpBindingPolicy, SessionRecord,
};
use crate::domains::sessions::store::completion_deliveries::{
    CompletionDeliveryRecord, CompletionDeliveryState,
};
use crate::domains::sessions::store::link_completions::LinkCompletionRecord;

#[test]
fn legacy_cursor_floor_includes_every_archived_queue_identity() {
    let mut archive = archive();
    assert_eq!(
        session_pending_prompt_cursor_lower_bound(&archive, &archive.sessions[0])
            .expect("reordered and retired identities"),
        9
    );

    archive.session_links.push(link());
    archive.session_link_completions.push(LinkCompletionRecord {
        completion_id: "projection-1".to_string(),
        session_link_id: "link-1".to_string(),
        child_turn_id: "turn-1".to_string(),
        child_last_event_seq: 1,
        outcome: SessionTurnOutcome::Completed,
        parent_event_seq: None,
        parent_prompt_seq: Some(11),
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
    });
    assert_eq!(
        session_pending_prompt_cursor_lower_bound(&archive, &archive.sessions[0])
            .expect("completion projection identity"),
        11
    );

    archive.sessions[0].pending_prompt_seq_cursor = Some(13);
    assert_eq!(
        session_pending_prompt_cursor_lower_bound(&archive, &archive.sessions[0])
            .expect("authoritative cursor"),
        13
    );
}

#[test]
fn cursor_floor_rejects_cross_session_event_ownership() {
    let mut archive = archive();
    archive.sessions[0].events[0].session_id = "other-session".to_string();
    assert!(session_pending_prompt_cursor_lower_bound(&archive, &archive.sessions[0]).is_err());
}

#[test]
fn cursor_floor_reserves_the_sql_integer_ceiling() {
    let mut archive_data = archive();
    archive_data.sessions[0].pending_prompt_seq_cursor = Some(MAX_PENDING_PROMPT_SEQ);
    assert_eq!(
        session_pending_prompt_cursor_lower_bound(&archive_data, &archive_data.sessions[0])
            .expect("greatest usable cursor is a clean exhausted state"),
        MAX_PENDING_PROMPT_SEQ,
    );

    archive_data.sessions[0].pending_prompt_seq_cursor = Some(i64::MAX);
    assert!(
        session_pending_prompt_cursor_lower_bound(&archive_data, &archive_data.sessions[0])
            .is_err()
    );

    let mut derived = archive();
    derived.sessions[0].events[0].payload_json = serde_json::json!({
        "type": "pending_prompts_reordered",
        "pendingPrompts": [{ "seq": i64::MAX }],
    })
    .to_string();
    assert!(session_pending_prompt_cursor_lower_bound(&derived, &derived.sessions[0]).is_err());

    let mut delivery_held = archive();
    delivery_held.session_link_completion_deliveries[0].retired_prompt_seq = Some(i64::MAX);
    assert!(
        session_pending_prompt_cursor_lower_bound(&delivery_held, &delivery_held.sessions[0])
            .is_err()
    );
}

#[test]
fn completion_delivery_validation_accepts_only_producible_retired_wake_intents() {
    let archive_data = archive();
    validate_archive_deliveries(&archive_data).expect("producer-shaped retired intent");

    assert_invalid_retired_intent(|delivery| delivery.retired_prompt_seq = None);
    assert_invalid_retired_intent(|delivery| delivery.retired_prompt_id = None);
    assert_invalid_retired_intent(|delivery| delivery.state = CompletionDeliveryState::Enqueued);
    assert_invalid_retired_intent(|delivery| delivery.outcome = SessionTurnOutcome::Failed);
    assert_invalid_retired_intent(|delivery| delivery.parent_prompt_seq = Some(9));
    assert_invalid_retired_intent(|delivery| delivery.parent_turn_id = Some("turn".to_string()));
    assert_invalid_retired_intent(|delivery| {
        delivery.retired_prompt_id = Some("unrelated-prompt".to_string())
    });

    let mut collision = archive();
    let retired_prompt_id = collision.session_link_completion_deliveries[0].prompt_id();
    collision.sessions[0]
        .pending_prompts
        .push(PendingPromptRecord {
            session_id: "parent".to_string(),
            seq: 9,
            queue_position: 1,
            prompt_id: Some(retired_prompt_id),
            text: "still active".to_string(),
            blocks_json: None,
            provenance_json: None,
            queued_at: "2026-03-25T00:00:00Z".to_string(),
        });
    assert!(validate_archive_deliveries(&collision).is_err());
}

fn validate_archive_deliveries(
    archive: &WorkspaceMobilityArchiveData,
) -> Result<(), MobilityError> {
    let session_ids = archive
        .sessions
        .iter()
        .map(|bundle| bundle.session.id.as_str())
        .collect();
    validate_completion_deliveries(archive, &session_ids)
}

fn assert_invalid_retired_intent(mutate: impl FnOnce(&mut CompletionDeliveryRecord)) {
    let mut archive = archive();
    mutate(&mut archive.session_link_completion_deliveries[0]);
    assert!(validate_archive_deliveries(&archive).is_err());
}

fn archive() -> WorkspaceMobilityArchiveData {
    WorkspaceMobilityArchiveData {
        source_workspace_id: Some("workspace-1".to_string()),
        source_workspace_path: "/source".to_string(),
        repo_root_path: "/source".to_string(),
        branch_name: Some("feature".to_string()),
        base_commit_sha: "abc123".to_string(),
        files: Vec::new(),
        deleted_paths: Vec::new(),
        sessions: vec![WorkspaceMobilitySessionBundleData {
            session: session(),
            pending_prompt_seq_cursor: None,
            live_config_snapshot: None,
            pending_config_changes: Vec::new(),
            pending_prompts: Vec::new(),
            prompt_attachments: Vec::new(),
            events: vec![SessionEventRecord {
                id: 0,
                session_id: "parent".to_string(),
                seq: 1,
                timestamp: "2026-03-25T00:00:00Z".to_string(),
                event_type: "pending_prompts_reordered".to_string(),
                turn_id: None,
                item_id: None,
                payload_json: serde_json::json!({
                    "type": "pending_prompts_reordered",
                    "pendingPrompts": [{
                        "seq": 7,
                        "text": "retired",
                        "queuedAt": "2026-03-25T00:00:00Z",
                    }],
                })
                .to_string(),
            }],
            raw_notifications: Vec::new(),
            agent_artifacts: Vec::new(),
        }],
        session_links: Vec::new(),
        session_link_completions: Vec::new(),
        session_link_completion_deliveries: vec![delivery()],
        session_link_wake_schedules: Vec::new(),
    }
}

fn session() -> SessionRecord {
    SessionRecord {
        id: "parent".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        agent_auth_contexts: None,
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

fn link() -> SessionLinkRecord {
    SessionLinkRecord {
        id: "link-1".to_string(),
        public_id: Some("subagent-1".to_string()),
        relation: SessionLinkRelation::Subagent,
        parent_session_id: "parent".to_string(),
        child_session_id: "child".to_string(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: None,
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        subagent_closed_at: None,
        closed_at: None,
    }
}

fn delivery() -> CompletionDeliveryRecord {
    let mut record = CompletionDeliveryRecord {
        delivery_id: "delivery-1".to_string(),
        completion_id: "completion-1".to_string(),
        session_link_id: "link-1".to_string(),
        parent_session_id: "parent".to_string(),
        child_session_id: "child".to_string(),
        subagent_public_id: Some("subagent-1".to_string()),
        label: None,
        child_turn_id: "turn-1".to_string(),
        child_last_event_seq: 1,
        outcome: SessionTurnOutcome::Completed,
        assistant_text: None,
        notification_text: "done".to_string(),
        state: CompletionDeliveryState::Delivered,
        parent_prompt_seq: None,
        parent_turn_id: None,
        retired_prompt_seq: Some(9),
        retired_prompt_id: None,
        attempt_count: 0,
        next_attempt_at: "2026-03-25T00:00:00Z".to_string(),
        lease_token: None,
        lease_expires_at: None,
        last_error_code: None,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
        enqueued_at: Some("2026-03-25T00:00:00Z".to_string()),
        delivered_at: Some("2026-03-25T00:00:00Z".to_string()),
    };
    record.retired_prompt_id = Some(record.prompt_id());
    record
}
