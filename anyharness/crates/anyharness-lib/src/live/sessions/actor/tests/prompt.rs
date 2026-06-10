use super::*;

#[test]
fn empty_turn_error_detects_end_turn_without_output() {
    let diagnostics = PromptDiagnostics::new(None);
    let snapshot = SessionEventSinkDebugSnapshot::default();

    assert!(should_emit_empty_turn_error(
        &StopReason::EndTurn,
        &diagnostics,
        &snapshot,
    ));
}

#[test]
fn empty_turn_error_ignores_cancelled_turns() {
    let diagnostics = PromptDiagnostics::new(None);
    let snapshot = SessionEventSinkDebugSnapshot::default();

    assert!(!should_emit_empty_turn_error(
        &StopReason::Cancelled,
        &diagnostics,
        &snapshot,
    ));
}

#[test]
fn empty_turn_error_ignores_turns_with_agent_content() {
    let mut diagnostics = PromptDiagnostics::new(None);
    let notif = acp::schema::SessionNotification::new(
        "native-1",
        acp::schema::SessionUpdate::AgentMessageChunk(acp::schema::ContentChunk::new("hello".into())),
    );
    diagnostics.observe_notification(&notif);

    assert!(!should_emit_empty_turn_error(
        &StopReason::EndTurn,
        &diagnostics,
        &SessionEventSinkDebugSnapshot::default(),
    ));
}

#[test]
fn prompt_diagnostics_records_only_marked_transient_status_text() {
    let mut diagnostics = PromptDiagnostics::new(None);
    let unmarked = acp::schema::SessionNotification::new(
        "native-1",
        acp::schema::SessionUpdate::AgentThoughtChunk(acp::schema::ContentChunk::new(
            "ordinary private thought".into(),
        )),
    );
    diagnostics.observe_notification(&unmarked);

    assert!(diagnostics.last_agent_thought_at.is_some());
    assert!(diagnostics.last_transient_status_at.is_none());
    assert!(diagnostics.last_transient_status.is_none());

    let meta = serde_json::json!({
        "anyharness": {
            "transcriptEvent": "transient_status"
        }
    })
    .as_object()
    .expect("object meta")
    .clone();
    let marked = acp::schema::SessionNotification::new(
        "native-1",
        acp::schema::SessionUpdate::AgentThoughtChunk(
            acp::schema::ContentChunk::new("Retrying Claude API request 1/10...".into()).meta(meta),
        ),
    );
    diagnostics.observe_notification(&marked);

    assert!(diagnostics.last_transient_status_at.is_some());
    assert_eq!(
        diagnostics.last_transient_status.as_deref(),
        Some("Retrying Claude API request 1/10...")
    );
    assert!(diagnostics.last_agent_preview.is_none());
}

#[test]
fn codex_prompt_inlines_first_prompt_append_only_before_first_turn() {
    assert_eq!(
        first_prompt_system_prompt_append_for_codex_prompt(
            "codex",
            Some("  Name workspace  "),
            false
        ),
        Some("Name workspace")
    );
    assert!(first_prompt_system_prompt_append_for_codex_prompt(
        "codex",
        Some("Name workspace"),
        true
    )
    .is_none());
    assert!(first_prompt_system_prompt_append_for_codex_prompt(
        "claude",
        Some("Name workspace"),
        false
    )
    .is_none());
    assert!(
        first_prompt_system_prompt_append_for_codex_prompt("codex", Some("   "), false).is_none()
    );
}

#[test]
fn prepend_system_prompt_append_adds_hidden_instruction_block() {
    let mut blocks = vec![acp::schema::ContentBlock::Text(acp::schema::TextContent::new(
        "Build a product".to_string(),
    ))];

    prepend_system_prompt_append_to_acp_blocks(&mut blocks, "Name the workspace first.");

    assert_eq!(blocks.len(), 2);
    let acp::schema::ContentBlock::Text(first) = &blocks[0] else {
        panic!("first block should be text");
    };
    assert!(first.text.contains("System instruction from AnyHarness"));
    assert!(first.text.contains("Name the workspace first."));
    let acp::schema::ContentBlock::Text(second) = &blocks[1] else {
        panic!("second block should be text");
    };
    assert_eq!(second.text, "Build a product");
}
