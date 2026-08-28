use super::*;

#[test]
fn create_session_request_serializes_model_mode_and_prompt() {
    let request = CreateSessionRequest {
        session_id: Some("01234567-89ab-4def-8123-456789abcdef".to_string()),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        model_id: Some("default".to_string()),
        mode_id: Some("bypassPermissions".to_string()),
        control_values: std::collections::BTreeMap::new(),
        system_prompt_append: Some(vec!["Rename the branch".to_string()]),
        subagents_enabled: None,
        origin: None,
    };

    let json = serde_json::to_value(&request).expect("serialize create request");
    assert_eq!(
        json,
        serde_json::json!({
            "sessionId": "01234567-89ab-4def-8123-456789abcdef",
            "workspaceId": "workspace-1",
            "agentKind": "claude",
            "modelId": "default",
            "modeId": "bypassPermissions",
            "systemPromptAppend": ["Rename the branch"]
        })
    );

    let round_tripped: CreateSessionRequest =
        serde_json::from_value(json).expect("deserialize create request");
    assert_eq!(round_tripped.model_id.as_deref(), Some("default"));
    assert_eq!(
        round_tripped.session_id.as_deref(),
        Some("01234567-89ab-4def-8123-456789abcdef")
    );
    assert_eq!(round_tripped.mode_id.as_deref(), Some("bypassPermissions"));
    assert_eq!(
        round_tripped.system_prompt_append,
        Some(vec!["Rename the branch".to_string()])
    );
}

#[test]
fn create_session_request_rejects_legacy_mcp_fields() {
    let error = serde_json::from_str::<CreateSessionRequest>(
        r#"{"workspaceId":"workspace-1","agentKind":"claude","mcpServers":[]}"#,
    )
    .expect_err("legacy MCP fields should be rejected");
    assert!(error.to_string().contains("unknown field"));
}

#[test]
fn resume_session_request_rejects_legacy_plugin_fields() {
    let error = serde_json::from_str::<ResumeSessionRequest>(r#"{"pluginBundle":{"plugins":[]}}"#)
        .expect_err("legacy plugin bundle should be rejected");
    assert!(error.to_string().contains("unknown field"));
}

#[test]
fn prompt_input_block_plan_reference_round_trips() {
    let block = PromptInputBlock::PlanReference {
        plan_id: "plan-123".to_string(),
        snapshot_hash: "hash-123".to_string(),
    };

    let json = serde_json::to_value(&block).expect("serialize plan reference prompt block");
    assert_eq!(
        json,
        serde_json::json!({
            "type": "plan_reference",
            "planId": "plan-123",
            "snapshotHash": "hash-123"
        })
    );

    let round_tripped: PromptInputBlock =
        serde_json::from_value(json).expect("deserialize plan reference prompt block");
    match round_tripped {
        PromptInputBlock::PlanReference {
            plan_id,
            snapshot_hash,
        } => {
            assert_eq!(plan_id, "plan-123");
            assert_eq!(snapshot_hash, "hash-123");
        }
        other => panic!("expected plan reference, got {other:?}"),
    }
}

#[test]
fn session_omits_removed_thinking_fields() {
    let session = Session {
        id: "session-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        model_id: Some("default".to_string()),
        requested_model_id: Some("default".to_string()),
        mode_id: Some("default".to_string()),
        requested_mode_id: Some("default".to_string()),
        title: Some("Fix auth refresh".to_string()),
        action_capabilities: SessionActionCapabilities::default(),
        live_config: None,
        execution_summary: None,
        mcp_binding_summaries: None,
        status: SessionStatus::Idle,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        pending_prompts: vec![],
        active_goal: None,
        activity: None,
        origin: None,
        serving_seat_id: None,
    };

    let json = serde_json::to_value(&session).expect("serialize session");

    assert!(json.get("thinkingLevelId").is_none());
    assert!(json.get("thinkingBudgetTokens").is_none());
    assert_eq!(
        json.get("title"),
        Some(&serde_json::json!("Fix auth refresh"))
    );
    // A seatless session never carries the key at all — clients can treat
    // absence and null alike, and non-seat wire payloads stay unchanged.
    assert!(json.get("servingSeatId").is_none());
}

#[test]
fn session_serving_seat_id_rides_the_wire_and_round_trips() {
    let mut session = Session {
        id: "session-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        model_id: None,
        requested_model_id: None,
        mode_id: None,
        requested_mode_id: None,
        title: None,
        action_capabilities: SessionActionCapabilities::default(),
        live_config: None,
        execution_summary: None,
        mcp_binding_summaries: None,
        status: SessionStatus::Idle,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        pending_prompts: vec![],
        active_goal: None,
        activity: None,
        origin: None,
        serving_seat_id: Some("01234567-89ab-4def-8123-456789abcdef".to_string()),
    };

    let json = serde_json::to_value(&session).expect("serialize session");
    assert_eq!(
        json.get("servingSeatId"),
        Some(&serde_json::json!("01234567-89ab-4def-8123-456789abcdef"))
    );

    let round_tripped: Session =
        serde_json::from_value(json).expect("deserialize session with a serving seat");
    assert_eq!(
        round_tripped.serving_seat_id.as_deref(),
        Some("01234567-89ab-4def-8123-456789abcdef")
    );

    // A payload without the key (an older runtime, or a seatless route)
    // deserializes to None rather than erroring.
    session.serving_seat_id = None;
    let json = serde_json::to_value(&session).expect("serialize seatless session");
    let round_tripped: Session =
        serde_json::from_value(json).expect("deserialize seatless session");
    assert_eq!(round_tripped.serving_seat_id, None);
}

#[test]
fn update_session_title_request_serializes_title() {
    let request = UpdateSessionTitleRequest {
        title: "Tighten retry logic".to_string(),
    };

    let json = serde_json::to_value(&request).expect("serialize title update");
    assert_eq!(json, serde_json::json!({ "title": "Tighten retry logic" }));
}

#[test]
fn resolve_interaction_request_debug_redacts_submitted_answers() {
    let request = ResolveInteractionRequest::Submitted {
        answers: vec![UserInputSubmittedAnswer {
            question_id: "secret".to_string(),
            selected_option_label: Some("do-not-log-option".to_string()),
            text: Some("do-not-log-text".to_string()),
        }],
    };

    let debug = format!("{request:?}");
    assert!(debug.contains("secret"));
    assert!(debug.contains("answer_count"));
    assert!(!debug.contains("do-not-log-option"));
    assert!(!debug.contains("do-not-log-text"));
}

#[test]
fn mcp_url_reveal_response_debug_redacts_full_url() {
    let response = McpElicitationUrlRevealResponse {
        url: "https://accounts.example.com/oauth?token=do-not-log".to_string(),
    };

    let debug = format!("{response:?}");
    assert!(debug.contains("<redacted>"));
    assert!(!debug.contains("do-not-log"));
    assert!(!debug.contains("accounts.example.com"));
}
