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
    let notif = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new("hello".into())),
    );
    diagnostics.observe_notification(&notif);

    assert!(!should_emit_empty_turn_error(
        &StopReason::EndTurn,
        &diagnostics,
        &SessionEventSinkDebugSnapshot::default(),
    ));
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
    let mut blocks = vec![acp::ContentBlock::Text(acp::TextContent::new(
        "Build a product".to_string(),
    ))];

    prepend_system_prompt_append_to_acp_blocks(&mut blocks, "Name the workspace first.");

    assert_eq!(blocks.len(), 2);
    let acp::ContentBlock::Text(first) = &blocks[0] else {
        panic!("first block should be text");
    };
    assert!(first.text.contains("System instruction from AnyHarness"));
    assert!(first.text.contains("Name the workspace first."));
    let acp::ContentBlock::Text(second) = &blocks[1] else {
        panic!("second block should be text");
    };
    assert_eq!(second.text, "Build a product");
}
