use std::path::PathBuf;
use std::time::Duration;

use serde_json::json;
use tokio::sync::mpsc;

use super::output::extract_terminal_result_text;
use super::watch::watch_async_agent;
use super::{detect_async_agent_registration, BACKGROUND_WORK_FALLBACK_RESULT};
use crate::app::test_support;
use crate::domains::sessions::model::{
    SessionBackgroundWorkRecord, SessionBackgroundWorkState, SessionBackgroundWorkTrackerKind,
    SessionRecord,
};
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::background_work::{BackgroundWorkOptions, BackgroundWorkRegistry};
use crate::live::sessions::sink::AcpToolPayload;
use crate::persistence::Db;

#[test]
fn detects_async_agent_launch_from_claude_tool_payload() {
    let payload = AcpToolPayload {
        tool_call_id: "tool-1".to_string(),
        raw_input: Some(json!({ "run_in_background": true })),
        meta: Some(json!({
            "claudeCode": {
                "tool_name": "Agent",
                "tool_response": {
                    "isAsync": true,
                    "agentId": "agent-1",
                    "outputFile": "/tmp/agent.output"
                }
            }
        })),
        ..Default::default()
    };

    let record = detect_async_agent_registration("session-1", "claude", "turn-1", &payload)
        .expect("registration");

    assert_eq!(record.tool_call_id, "tool-1");
    assert_eq!(record.turn_id, "turn-1");
    assert_eq!(record.agent_id.as_deref(), Some("agent-1"));
    assert_eq!(record.output_file, "/tmp/agent.output");
}

#[test]
fn extracts_terminal_result_text_from_nested_message_payload() {
    let result = extract_terminal_result_text(
        &json!({
            "type": "assistant",
            "message": {
                "stop_reason": "end_turn",
                "content": [
                    { "type": "text", "text": "First paragraph." },
                    { "type": "text", "text": "Second paragraph." }
                ]
            }
        })
        .to_string(),
    );

    assert_eq!(
        result.as_deref(),
        Some("First paragraph.\n\nSecond paragraph.")
    );
}

#[test]
fn ignores_tool_use_stop_reasons() {
    let result = extract_terminal_result_text(
        &json!({
            "type": "assistant",
            "message": {
                "stop_reason": "tool_use",
                "content": [
                    { "type": "text", "text": "Let me inspect the repo first." }
                ]
            }
        })
        .to_string(),
    );

    assert!(result.is_none());
}

#[tokio::test]
async fn watch_async_agent_emits_completed_result_text() {
    let store = seeded_store();
    let output_file = write_output_file(
        "completed",
        &json!({
            "type": "assistant",
            "message": {
                "stop_reason": "end_turn",
                "content": [{ "type": "text", "text": "Final report." }]
            }
        })
        .to_string(),
    );
    let record = pending_record(&output_file, &chrono::Utc::now().to_rfc3339());
    store
        .upsert_or_refresh_pending_background_work(&record)
        .expect("upsert pending background work");
    let (updates_tx, mut updates_rx) = mpsc::unbounded_channel();

    watch_async_agent(
        record,
        std::sync::Arc::new(store),
        updates_tx,
        BackgroundWorkOptions {
            poll_interval: Duration::from_millis(5),
            stale_after: Some(Duration::from_secs(30)),
        },
    )
    .await;

    let update = updates_rx.recv().await.expect("background work update");
    assert_eq!(update.state, SessionBackgroundWorkState::Completed);
    assert_eq!(update.result_text, "Final report.");
}

#[tokio::test]
async fn watch_async_agent_uses_neutral_fallback_when_terminal_message_has_no_text() {
    let store = seeded_store();
    let output_file = write_output_file(
        "empty-terminal",
        &json!({
            "type": "assistant",
            "message": {
                "stop_reason": "end_turn",
                "content": []
            }
        })
        .to_string(),
    );
    let record = pending_record(&output_file, &chrono::Utc::now().to_rfc3339());
    store
        .upsert_or_refresh_pending_background_work(&record)
        .expect("upsert pending background work");
    let (updates_tx, mut updates_rx) = mpsc::unbounded_channel();

    watch_async_agent(
        record,
        std::sync::Arc::new(store),
        updates_tx,
        BackgroundWorkOptions {
            poll_interval: Duration::from_millis(5),
            stale_after: Some(Duration::from_secs(30)),
        },
    )
    .await;

    let update = updates_rx.recv().await.expect("background work update");
    assert_eq!(update.state, SessionBackgroundWorkState::Completed);
    assert_eq!(update.result_text, BACKGROUND_WORK_FALLBACK_RESULT);
}

#[tokio::test]
async fn watch_async_agent_ignores_tool_use_until_end_turn() {
    let store = seeded_store();
    let output_file = write_output_file(
        "tool-use-then-final",
        &[
            json!({
                "type": "assistant",
                "message": {
                    "stop_reason": "tool_use",
                    "content": [
                        { "type": "text", "text": "Let me browse a bit first." },
                        {
                            "type": "tool_use",
                            "id": "toolu_123",
                            "name": "Bash",
                            "input": { "command": "ls" }
                        }
                    ]
                }
            })
            .to_string(),
            json!({
                "type": "assistant",
                "message": {
                    "stop_reason": "end_turn",
                    "content": [{ "type": "text", "text": "Final favorite file." }]
                }
            })
            .to_string(),
        ]
        .join("\n"),
    );
    let record = pending_record(&output_file, &chrono::Utc::now().to_rfc3339());
    store
        .upsert_or_refresh_pending_background_work(&record)
        .expect("upsert pending background work");
    let (updates_tx, mut updates_rx) = mpsc::unbounded_channel();

    watch_async_agent(
        record,
        std::sync::Arc::new(store),
        updates_tx,
        BackgroundWorkOptions {
            poll_interval: Duration::from_millis(5),
            stale_after: Some(Duration::from_secs(30)),
        },
    )
    .await;

    let update = updates_rx.recv().await.expect("background work update");
    assert_eq!(update.state, SessionBackgroundWorkState::Completed);
    assert_eq!(update.result_text, "Final favorite file.");
}

#[tokio::test]
async fn watch_async_agent_expires_when_the_output_file_stops_updating() {
    let store = seeded_store();
    let output_file = unique_output_path("expired");
    let record = pending_record(
        &output_file.to_string_lossy(),
        &(chrono::Utc::now() - chrono::Duration::minutes(20)).to_rfc3339(),
    );
    store
        .upsert_or_refresh_pending_background_work(&record)
        .expect("upsert pending background work");
    let (updates_tx, mut updates_rx) = mpsc::unbounded_channel();

    watch_async_agent(
        record,
        std::sync::Arc::new(store),
        updates_tx,
        BackgroundWorkOptions {
            poll_interval: Duration::from_millis(5),
            stale_after: Some(Duration::from_millis(5)),
        },
    )
    .await;

    let update = updates_rx.recv().await.expect("background work update");
    assert_eq!(update.state, SessionBackgroundWorkState::Expired);
    assert_eq!(update.result_text, BACKGROUND_WORK_FALLBACK_RESULT);
}

#[tokio::test(flavor = "current_thread")]
async fn registry_rehydrates_pending_background_work_and_completes_it() {
    // BackgroundWorkRegistry uses spawn_local, so the test must run inside a LocalSet.
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let store = seeded_store();
            let output_file = write_output_file(
                "rehydrated",
                &json!({
                    "type": "assistant",
                    "message": {
                        "stop_reason": "end_turn",
                        "content": [{ "type": "text", "text": "Recovered result." }]
                    }
                })
                .to_string(),
            );
            let record = pending_record(&output_file, &chrono::Utc::now().to_rfc3339());
            store
                .upsert_or_refresh_pending_background_work(&record)
                .expect("upsert pending background work");
            let (updates_tx, mut updates_rx) = mpsc::unbounded_channel();
            let mut registry = BackgroundWorkRegistry::new(
                "session-1".to_string(),
                "claude".to_string(),
                std::sync::Arc::new(store),
                updates_tx,
                BackgroundWorkOptions {
                    poll_interval: Duration::from_millis(5),
                    stale_after: Some(Duration::from_secs(30)),
                },
            );

            registry.rehydrate_pending().await;
            let update = tokio::time::timeout(Duration::from_millis(250), updates_rx.recv())
                .await
                .expect("timeout waiting for background work update")
                .expect("background work update");
            assert_eq!(update.tool_call_id, "tool-1");
            assert_eq!(update.result_text, "Recovered result.");
            registry.shutdown();
        })
        .await;
}

fn seeded_store() -> SessionStore {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");

    let store = SessionStore::new(db);
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: Some("native-1".to_string()),
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-04-11T00:00:00Z".to_string(),
            updated_at: "2026-04-11T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy:
                crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        })
        .expect("insert session");
    store
}

fn pending_record(output_file: &str, last_activity_at: &str) -> SessionBackgroundWorkRecord {
    SessionBackgroundWorkRecord {
        session_id: "session-1".to_string(),
        tool_call_id: "tool-1".to_string(),
        turn_id: "turn-1".to_string(),
        tracker_kind: SessionBackgroundWorkTrackerKind::ClaudeAsyncAgent,
        source_agent_kind: "claude".to_string(),
        agent_id: Some("agent-1".to_string()),
        output_file: output_file.to_string(),
        state: SessionBackgroundWorkState::Pending,
        created_at: last_activity_at.to_string(),
        updated_at: last_activity_at.to_string(),
        launched_at: last_activity_at.to_string(),
        last_activity_at: last_activity_at.to_string(),
        completed_at: None,
    }
}

fn write_output_file(prefix: &str, contents: &str) -> String {
    let path = unique_output_path(prefix);
    std::fs::write(&path, format!("{contents}\n")).expect("write output file");
    path.to_string_lossy().into_owned()
}

fn unique_output_path(prefix: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "anyharness-background-work-{prefix}-{}.jsonl",
        uuid::Uuid::new_v4()
    ));
    path
}
