use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::{BackgroundWorkOptions, BackgroundWorkUpdate};
use crate::acp::event_sink::AcpToolPayload;
use crate::sessions::model::{
    SessionBackgroundWorkRecord, SessionBackgroundWorkState, SessionBackgroundWorkTrackerKind,
};
use crate::sessions::store::SessionStore;

const BACKGROUND_WORK_FALLBACK_RESULT: &str =
    "Background subagent stopped updating before a final result was observed.";

#[derive(Debug, Clone, Default, Deserialize)]
struct ClaudeToolMetaEnvelope {
    #[serde(rename = "claudeCode")]
    claude_code: Option<ClaudeToolMeta>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ClaudeToolMeta {
    #[serde(rename = "toolName", alias = "tool_name")]
    tool_name: Option<String>,
    #[serde(default, rename = "toolResponse", alias = "tool_response")]
    tool_response: Option<serde_json::Value>,
}

pub fn detect_async_agent_registration(
    session_id: &str,
    source_agent_kind: &str,
    turn_id: &str,
    payload: &AcpToolPayload,
) -> Option<SessionBackgroundWorkRecord> {
    if !matches!(payload.raw_input.as_ref(), Some(value) if value.get("run_in_background").and_then(serde_json::Value::as_bool) == Some(true)) {
        return None;
    }

    let meta: ClaudeToolMetaEnvelope = serde_json::from_value(payload.meta.clone()?).ok()?;
    let claude_meta = meta.claude_code?;
    if claude_meta.tool_name.as_deref() != Some("Agent") {
        return None;
    }

    let tool_response = claude_meta.tool_response?;
    if tool_response.get("isAsync").and_then(serde_json::Value::as_bool) != Some(true) {
        return None;
    }

    let output_file = tool_response
        .get("outputFile")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    let now = chrono::Utc::now().to_rfc3339();

    Some(SessionBackgroundWorkRecord {
        session_id: session_id.to_string(),
        tool_call_id: payload.tool_call_id.clone(),
        turn_id: turn_id.to_string(),
        tracker_kind: SessionBackgroundWorkTrackerKind::ClaudeAsyncAgent,
        source_agent_kind: source_agent_kind.to_string(),
        agent_id: tool_response
            .get("agentId")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(String::from),
        output_file: output_file.to_string(),
        state: SessionBackgroundWorkState::Pending,
        created_at: now.clone(),
        updated_at: now.clone(),
        launched_at: now.clone(),
        last_activity_at: now,
        completed_at: None,
    })
}

pub fn spawn_async_agent_tracker(
    record: SessionBackgroundWorkRecord,
    store: SessionStore,
    updates_tx: mpsc::UnboundedSender<BackgroundWorkUpdate>,
    options: BackgroundWorkOptions,
) -> JoinHandle<()> {
    tokio::task::spawn_local(async move {
        watch_async_agent(record, store, updates_tx, options).await;
    })
}

async fn watch_async_agent(
    record: SessionBackgroundWorkRecord,
    store: SessionStore,
    updates_tx: mpsc::UnboundedSender<BackgroundWorkUpdate>,
    options: BackgroundWorkOptions,
) {
    let output_path = resolve_output_path(&record.output_file).await;
    let mut cursor = 0_u64;
    let mut remainder = Vec::new();
    let mut last_activity_at = parse_timestamp(&record.last_activity_at);
    let mut interval = tokio::time::interval(options.poll_interval);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        match inspect_output_file(&output_path, &mut cursor, &mut remainder).await {
            Ok(observation) => {
                if let Some(activity_at) = observation.activity_at {
                    if activity_at > last_activity_at {
                        last_activity_at = activity_at;
                        if let Err(error) = store.touch_background_work_activity(
                            &record.session_id,
                            &record.tool_call_id,
                            &activity_at.to_rfc3339(),
                        ) {
                            tracing::warn!(
                                session_id = %record.session_id,
                                tool_call_id = %record.tool_call_id,
                                error = %error,
                                "failed to update background work activity timestamp"
                            );
                        }
                    }
                }

                if let Some(result_text) = observation.result_text {
                    let _ = updates_tx.send(BackgroundWorkUpdate {
                        tool_call_id: record.tool_call_id.clone(),
                        turn_id: record.turn_id.clone(),
                        state: SessionBackgroundWorkState::Completed,
                        agent_id: record.agent_id.clone(),
                        output_file: record.output_file.clone(),
                        result_text,
                    });
                    return;
                }
            }
            Err(error) => {
                tracing::debug!(
                    session_id = %record.session_id,
                    tool_call_id = %record.tool_call_id,
                    output_file = %record.output_file,
                    error = %error,
                    "background work tracker failed to inspect output file"
                );
            }
        }

        if let Some(stale_after) = options.stale_after {
            let stale_after = chrono::Duration::from_std(stale_after).unwrap_or_else(|_| {
                chrono::Duration::from_std(Duration::from_secs(60 * 10)).expect("default duration")
            });
            if chrono::Utc::now().signed_duration_since(last_activity_at) >= stale_after {
                let _ = updates_tx.send(BackgroundWorkUpdate {
                    tool_call_id: record.tool_call_id.clone(),
                    turn_id: record.turn_id.clone(),
                    state: SessionBackgroundWorkState::Expired,
                    agent_id: record.agent_id.clone(),
                    output_file: record.output_file.clone(),
                    result_text: BACKGROUND_WORK_FALLBACK_RESULT.to_string(),
                });
                return;
            }
        }

        interval.tick().await;
    }
}

#[derive(Debug)]
struct FileObservation {
    activity_at: Option<chrono::DateTime<chrono::Utc>>,
    result_text: Option<String>,
}

async fn resolve_output_path(output_file: &str) -> PathBuf {
    let original_path = PathBuf::from(output_file);
    match tokio::fs::canonicalize(&original_path).await {
        Ok(path) => path,
        Err(_) => original_path,
    }
}

async fn inspect_output_file(
    output_path: &PathBuf,
    cursor: &mut u64,
    remainder: &mut Vec<u8>,
) -> anyhow::Result<FileObservation> {
    let metadata = tokio::fs::metadata(output_path).await?;
    if metadata.len() < *cursor {
        *cursor = 0;
        remainder.clear();
    }

    let activity_at = metadata
        .modified()
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from);
    if metadata.len() == *cursor {
        return Ok(FileObservation {
            activity_at: None,
            result_text: None,
        });
    }

    let mut file = tokio::fs::File::open(output_path).await?;
    file.seek(std::io::SeekFrom::Start(*cursor)).await?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).await?;
    *cursor += bytes.len() as u64;

    let mut chunk = std::mem::take(remainder);
    chunk.extend(bytes);

    let (complete_bytes, trailing_remainder) = match chunk.iter().rposition(|byte| *byte == b'\n') {
        Some(index) => (&chunk[..=index], &chunk[index + 1..]),
        None => {
            *remainder = chunk;
            return Ok(FileObservation {
                activity_at,
                result_text: None,
            });
        }
    };
    *remainder = trailing_remainder.to_vec();
    let complete_text = std::str::from_utf8(complete_bytes)?;

    let mut result_text = None;
    for line in complete_text.lines().filter(|line| !line.trim().is_empty()) {
        let Some(next_result_text) = extract_terminal_result_text(line) else {
            continue;
        };
        result_text = Some(next_result_text);
    }

    Ok(FileObservation {
        activity_at,
        result_text,
    })
}

fn extract_terminal_result_text(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(serde_json::Value::as_str) != Some("assistant") {
        return None;
    }

    let message = value.get("message")?;
    let stop_reason = message.get("stop_reason")?.as_str()?;
    if !is_terminal_stop_reason(stop_reason) {
        return None;
    }

    let text = message
        .get("content")
        .and_then(serde_json::Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter(|part| part.get("type").and_then(serde_json::Value::as_str) == Some("text"))
                .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n")
        })
        .unwrap_or_default();

    if text.trim().is_empty() {
        return Some(BACKGROUND_WORK_FALLBACK_RESULT.to_string());
    }

    Some(text)
}

fn is_terminal_stop_reason(stop_reason: &str) -> bool {
    matches!(stop_reason, "end_turn" | "stop_sequence" | "max_tokens")
}

fn parse_timestamp(value: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|ts| ts.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use serde_json::json;
    use tokio::sync::mpsc;

    use super::{
        detect_async_agent_registration, extract_terminal_result_text, watch_async_agent,
        BACKGROUND_WORK_FALLBACK_RESULT,
    };
    use crate::acp::background_work::{BackgroundWorkOptions, BackgroundWorkRegistry};
    use crate::acp::event_sink::AcpToolPayload;
    use crate::persistence::Db;
    use crate::sessions::model::{
        SessionBackgroundWorkRecord, SessionBackgroundWorkState, SessionBackgroundWorkTrackerKind,
        SessionRecord,
    };
    use crate::sessions::store::SessionStore;

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

        let record = detect_async_agent_registration(
            "session-1",
            "claude",
            "turn-1",
            &payload,
        )
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
            store,
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
            store,
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
            store,
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
            store,
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
                    store,
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
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                rusqlite::params!["workspace-1", "2026-04-11T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");

        let store = SessionStore::new(db);
        store
            .insert(&SessionRecord {
                id: "session-1".to_string(),
                workspace_id: "workspace-1".to_string(),
                agent_kind: "claude".to_string(),
                native_session_id: Some("native-1".to_string()),
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
}
