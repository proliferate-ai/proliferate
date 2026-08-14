use anyharness_contract::v1::{
    ContentPart, FileReadScope, ItemCompletedEvent, PromptProvenance, SessionEvent,
    TerminalLifecycleEvent, TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus,
};

use super::*;
use crate::app::test_support;
use crate::domains::sessions::model::{SessionEventRecord, SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::SessionStore;
use crate::persistence::Db;

fn store() -> SessionStore {
    let db = Db::open_in_memory().expect("database");
    test_support::seed_workspace_with_repo_root(
        &db,
        "workspace",
        "local",
        "/tmp/task-output-workspace",
    );
    let store = SessionStore::new(db);
    store
        .insert(&SessionRecord {
            id: "target".into(),
            workspace_id: "workspace".into(),
            agent_kind: "codex".into(),
            native_session_id: Some("native-target".into()),
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".into(),
            created_at: "2026-08-11T00:00:00Z".into(),
            updated_at: "2026-08-11T00:00:00Z".into(),
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
        })
        .expect("insert session");
    store
}

fn append(
    store: &SessionStore,
    seq: i64,
    kind: TranscriptItemKind,
    status: TranscriptItemStatus,
    text: &str,
    provenance: Option<PromptProvenance>,
) {
    append_payload(
        store,
        seq,
        TranscriptItemPayload {
            kind,
            status,
            source_agent_kind: "codex".into(),
            is_transient: false,
            message_id: Some(format!("message-{seq}")),
            prompt_id: None,
            title: None,
            tool_call_id: None,
            native_tool_name: None,
            parent_tool_call_id: None,
            raw_input: None,
            raw_output: None,
            content_parts: vec![ContentPart::Text { text: text.into() }],
            prompt_provenance: provenance,
        },
    );
}

fn append_payload(store: &SessionStore, seq: i64, item: TranscriptItemPayload) {
    let event = SessionEvent::ItemCompleted(ItemCompletedEvent { item });
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "target".into(),
            seq,
            timestamp: format!("2026-08-11T00:00:{seq:02}Z"),
            event_type: "item_completed".into(),
            turn_id: None,
            item_id: Some(format!("item-{seq}")),
            payload_json: serde_json::to_string(&event).unwrap(),
        })
        .unwrap();
}

#[test]
fn defaults_and_maximum_are_bounded_and_chronological() {
    let store = store();
    for seq in 1..=55 {
        append(
            &store,
            seq,
            TranscriptItemKind::AssistantMessage,
            TranscriptItemStatus::Completed,
            &format!("message {seq}"),
            None,
        );
    }

    let default = read_task_output(&store, "target", None, DEFAULT_TASK_OUTPUT_LIMIT).unwrap();
    assert_eq!(default.messages.len(), 10);
    assert_eq!(default.messages.first().unwrap().text, "message 46");
    assert_eq!(default.messages.last().unwrap().text, "message 55");
    assert!(default.truncated);
    assert!(default.next_cursor.is_some());

    let maximum = read_task_output(&store, "target", None, MAX_TASK_OUTPUT_LIMIT).unwrap();
    assert_eq!(maximum.messages.len(), 50);
    assert!(matches!(
        read_task_output(&store, "target", None, 0),
        Err(TaskOutputError::InvalidLimit)
    ));
    assert!(matches!(
        read_task_output(&store, "target", None, 51),
        Err(TaskOutputError::InvalidLimit)
    ));
}

#[test]
fn cursor_is_exclusive_and_stable_while_new_messages_append() {
    let store = store();
    for seq in 1..=6 {
        append(
            &store,
            seq,
            TranscriptItemKind::AssistantMessage,
            TranscriptItemStatus::Completed,
            &format!("message {seq}"),
            None,
        );
    }
    let first = read_task_output(&store, "target", None, 2).unwrap();
    append(
        &store,
        7,
        TranscriptItemKind::AssistantMessage,
        TranscriptItemStatus::Completed,
        "message 7",
        None,
    );
    let second = read_task_output(&store, "target", first.next_cursor.as_deref(), 2).unwrap();
    let third = read_task_output(&store, "target", second.next_cursor.as_deref(), 2).unwrap();

    let texts = first
        .messages
        .iter()
        .chain(&second.messages)
        .chain(&third.messages)
        .map(|message| message.text.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        texts,
        [
            "message 5",
            "message 6",
            "message 3",
            "message 4",
            "message 1",
            "message 2"
        ]
    );
}

#[test]
fn projection_excludes_non_visible_items_and_preserves_public_provenance() {
    let store = store();
    append(
        &store,
        1,
        TranscriptItemKind::ToolInvocation,
        TranscriptItemStatus::Completed,
        "secret tool output",
        None,
    );
    append(
        &store,
        2,
        TranscriptItemKind::Reasoning,
        TranscriptItemStatus::Completed,
        "hidden reasoning",
        None,
    );
    append(
        &store,
        3,
        TranscriptItemKind::UserMessage,
        TranscriptItemStatus::Completed,
        "hidden system addition",
        Some(PromptProvenance::System { label: None }),
    );
    append(
        &store,
        4,
        TranscriptItemKind::AssistantMessage,
        TranscriptItemStatus::InProgress,
        "partial duplicate",
        None,
    );
    append(
        &store,
        5,
        TranscriptItemKind::Plan,
        TranscriptItemStatus::Completed,
        "hidden plan",
        None,
    );
    append(
        &store,
        6,
        TranscriptItemKind::ErrorItem,
        TranscriptItemStatus::Completed,
        "hidden error",
        None,
    );
    append(
        &store,
        7,
        TranscriptItemKind::AssistantMessage,
        TranscriptItemStatus::Completed,
        "   ",
        None,
    );
    let mut transient = TranscriptItemPayload {
        kind: TranscriptItemKind::AssistantMessage,
        status: TranscriptItemStatus::Completed,
        source_agent_kind: "codex".into(),
        is_transient: true,
        message_id: Some("transient".into()),
        prompt_id: None,
        title: None,
        tool_call_id: None,
        native_tool_name: None,
        parent_tool_call_id: None,
        raw_input: None,
        raw_output: None,
        content_parts: vec![ContentPart::Text {
            text: "transient duplicate".into(),
        }],
        prompt_provenance: None,
    };
    append_payload(&store, 8, transient.clone());
    transient.is_transient = false;
    transient.raw_input = Some(serde_json::json!({ "secret": "raw input" }));
    transient.raw_output = Some(serde_json::json!({ "secret": "raw output" }));
    transient.content_parts = vec![
        ContentPart::Text {
            text: "visible answer".into(),
        },
        ContentPart::ResourceLink {
            uri: "file:///secret".into(),
            name: "hidden resource".into(),
            mime_type: Some("text/plain".into()),
            title: None,
            description: None,
            size: None,
        },
        ContentPart::ToolCall {
            tool_call_id: "secret-call".into(),
            title: "hidden tool call".into(),
            tool_kind: None,
            native_tool_name: None,
        },
        ContentPart::TerminalOutput {
            terminal_id: "terminal-secret".into(),
            event: TerminalLifecycleEvent::Output,
            data: Some("hidden terminal output".into()),
            data_truncated: None,
            data_original_bytes: None,
            exit_code: None,
            signal: None,
        },
        ContentPart::FileRead {
            path: "/secret/file".into(),
            workspace_path: Some("secret/file".into()),
            basename: Some("file".into()),
            line: None,
            scope: Some(FileReadScope::Full),
            start_line: None,
            end_line: None,
            preview: Some("hidden file content".into()),
            preview_truncated: None,
            preview_original_bytes: None,
        },
    ];
    append_payload(&store, 9, transient);
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "target".into(),
            seq: 10,
            timestamp: "2026-08-11T00:00:10Z".into(),
            event_type: "item_delta".into(),
            turn_id: None,
            item_id: Some("delta".into()),
            payload_json: r#"{"type":"item_delta","delta":{"appendText":"hidden delta"}}"#.into(),
        })
        .unwrap();
    append(
        &store,
        11,
        TranscriptItemKind::UserMessage,
        TranscriptItemStatus::Completed,
        "agent request",
        Some(PromptProvenance::AgentSession {
            source_session_id: "sender-session".into(),
            session_link_id: Some("internal-link".into()),
            label: Some("Build agent".into()),
        }),
    );
    append(
        &store,
        12,
        TranscriptItemKind::AssistantMessage,
        TranscriptItemStatus::Completed,
        "final answer",
        None,
    );

    let page = read_task_output(&store, "target", None, 10).unwrap();
    assert_eq!(page.messages.len(), 3);
    assert_eq!(page.messages[0].text, "visible answer");
    assert_eq!(page.messages[1].role, TaskOutputRole::User);
    assert_eq!(
        page.messages[1].sender,
        TaskOutputSender::Agent {
            session_id: Some("sender-session".into()),
            label: "Build agent".into(),
        }
    );
    assert_eq!(page.messages[2].role, TaskOutputRole::Assistant);
    let serialized = serde_json::to_string(&page).unwrap();
    assert!(!serialized.contains("internal-link"));
    assert!(!serialized.contains("secret tool output"));
    assert!(!serialized.contains("hidden reasoning"));
    for excluded in [
        "hidden system addition",
        "partial duplicate",
        "hidden plan",
        "hidden error",
        "transient duplicate",
        "raw input",
        "raw output",
        "hidden resource",
        "hidden tool call",
        "hidden terminal output",
        "hidden file content",
        "hidden delta",
    ] {
        assert!(!serialized.contains(excluded), "leaked {excluded}");
    }
}

#[test]
fn oversized_unicode_message_is_safely_and_explicitly_truncated() {
    let store = store();
    append(
        &store,
        1,
        TranscriptItemKind::AssistantMessage,
        TranscriptItemStatus::Completed,
        &"🦀é".repeat(40_000),
        None,
    );
    let page = read_task_output(&store, "target", None, 10).unwrap();
    assert_eq!(page.messages.len(), 1);
    assert!(page.messages[0].truncated);
    assert!(page.messages[0].text.ends_with(TRUNCATION_MARKER));
    assert!(page.truncated);
    assert!(serde_json::to_vec(&page).unwrap().len() <= MAX_TASK_OUTPUT_PAGE_BYTES);
}

#[test]
fn oversized_message_cursor_advances_exclusively_without_looping() {
    let store = store();
    append(
        &store,
        1,
        TranscriptItemKind::AssistantMessage,
        TranscriptItemStatus::Completed,
        "older answer",
        None,
    );
    append(
        &store,
        2,
        TranscriptItemKind::AssistantMessage,
        TranscriptItemStatus::Completed,
        &"🦀".repeat(40_000),
        None,
    );

    let first = read_task_output(&store, "target", None, 1).unwrap();
    assert!(first.messages[0].truncated);
    let first_cursor = first.next_cursor.as_deref().expect("older lookahead");
    let second = read_task_output(&store, "target", Some(first_cursor), 1).unwrap();

    assert_eq!(second.messages.len(), 1);
    assert_eq!(second.messages[0].text, "older answer");
    assert!(!second.messages[0].truncated);
    assert!(second.next_cursor.is_none());
}

#[test]
fn invalid_or_nonpositive_cursors_are_rejected() {
    let store = store();
    assert!(matches!(
        read_task_output(&store, "target", Some("not-base64"), 10),
        Err(TaskOutputError::InvalidCursor)
    ));
    let zero = URL_SAFE_NO_PAD.encode(br#"{"beforeSeq":0}"#);
    assert!(matches!(
        read_task_output(&store, "target", Some(&zero), 10),
        Err(TaskOutputError::InvalidCursor)
    ));
}
