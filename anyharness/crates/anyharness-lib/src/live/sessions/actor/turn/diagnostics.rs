use std::time::Instant;

use agent_client_protocol as acp;

#[derive(Debug, Clone)]
pub(in crate::live::sessions::actor) struct PromptDiagnostics {
    pub(in crate::live::sessions::actor) prompt_started_at: Instant,
    pub(in crate::live::sessions::actor) prompt_id: Option<String>,
    pub(in crate::live::sessions::actor) last_raw_kind: Option<&'static str>,
    pub(in crate::live::sessions::actor) last_raw_at: Option<Instant>,
    pub(in crate::live::sessions::actor) last_agent_chunk_at: Option<Instant>,
    pub(in crate::live::sessions::actor) last_agent_thought_at: Option<Instant>,
    pub(in crate::live::sessions::actor) last_agent_preview: Option<String>,
    pub(in crate::live::sessions::actor) last_tool_event_at: Option<Instant>,
    pub(in crate::live::sessions::actor) last_plan_at: Option<Instant>,
    pub(in crate::live::sessions::actor) last_usage_at: Option<Instant>,
}

impl PromptDiagnostics {
    pub(in crate::live::sessions::actor) fn new(prompt_id: Option<String>) -> Self {
        Self {
            prompt_started_at: Instant::now(),
            prompt_id,
            last_raw_kind: None,
            last_raw_at: None,
            last_agent_chunk_at: None,
            last_agent_thought_at: None,
            last_agent_preview: None,
            last_tool_event_at: None,
            last_plan_at: None,
            last_usage_at: None,
        }
    }

    pub(in crate::live::sessions::actor) fn observe_notification(
        &mut self,
        notif: &acp::SessionNotification,
    ) {
        let kind =
            crate::live::sessions::connection::runtime_client::session_update_kind(&notif.update);
        let now = Instant::now();
        self.last_raw_kind = Some(kind);
        self.last_raw_at = Some(now);

        match &notif.update {
            acp::SessionUpdate::AgentMessageChunk(chunk) => {
                let preview = content_block_preview(&chunk.content);
                if !preview.trim().is_empty() {
                    self.last_agent_chunk_at = Some(now);
                    self.last_agent_preview = Some(preview);
                }
            }
            acp::SessionUpdate::AgentThoughtChunk(chunk) => {
                if !content_block_preview(&chunk.content).trim().is_empty() {
                    self.last_agent_thought_at = Some(now);
                }
            }
            acp::SessionUpdate::ToolCall(_) | acp::SessionUpdate::ToolCallUpdate(_) => {
                self.last_tool_event_at = Some(now);
            }
            acp::SessionUpdate::Plan(_) => {
                self.last_plan_at = Some(now);
            }
            acp::SessionUpdate::UsageUpdate(_) => {
                self.last_usage_at = Some(now);
            }
            _ => {}
        }
    }
}

fn content_block_preview(content: &acp::ContentBlock) -> String {
    let value = serde_json::to_value(content).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(text) = value.get("text").and_then(|text| text.as_str()) {
        return truncate_preview(text, 120);
    }
    truncate_preview(&value.to_string(), 120)
}

fn truncate_preview(text: &str, max_chars: usize) -> String {
    let mut preview = String::new();
    for ch in text.chars().take(max_chars) {
        preview.push(ch);
    }
    if text.chars().count() > max_chars {
        preview.push_str("...");
    }
    preview
}

pub(in crate::live::sessions::actor) fn age_ms(since: Option<Instant>) -> u64 {
    since
        .map(|instant| instant.elapsed().as_millis() as u64)
        .unwrap_or(0)
}
