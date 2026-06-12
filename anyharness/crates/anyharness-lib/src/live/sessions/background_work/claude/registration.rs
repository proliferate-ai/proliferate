use serde::Deserialize;

use crate::domains::sessions::model::{
    SessionBackgroundWorkRecord, SessionBackgroundWorkState, SessionBackgroundWorkTrackerKind,
};
use crate::live::sessions::sink::AcpToolPayload;

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

pub(super) fn detect_async_agent_registration(
    session_id: &str,
    source_agent_kind: &str,
    turn_id: &str,
    payload: &AcpToolPayload,
) -> Option<SessionBackgroundWorkRecord> {
    if !matches!(payload.raw_input.as_ref(), Some(value) if value.get("run_in_background").and_then(serde_json::Value::as_bool) == Some(true))
    {
        return None;
    }

    let meta: ClaudeToolMetaEnvelope = serde_json::from_value(payload.meta.clone()?).ok()?;
    let claude_meta = meta.claude_code?;
    if claude_meta.tool_name.as_deref() != Some("Agent") {
        return None;
    }

    let tool_response = claude_meta.tool_response?;
    if tool_response
        .get("isAsync")
        .and_then(serde_json::Value::as_bool)
        != Some(true)
    {
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
