use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use super::model::SessionEventRecord;
use super::service::SessionService;
use super::store::SessionStore;

pub const DEFAULT_TASK_OUTPUT_LIMIT: usize = 10;
pub const MAX_TASK_OUTPUT_LIMIT: usize = 50;
/// Leaves room for the MCP result envelope and its independent text
/// representation under the frozen 65,536-byte wire limit.
pub const MAX_TASK_OUTPUT_PAGE_BYTES: usize = 60 * 1024;

const EVENT_BATCH_SIZE: i64 = 128;
const TRUNCATION_MARKER: &str = "\n[truncated to fit task output byte limit]";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskOutputRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TaskOutputSender {
    User {
        label: String,
    },
    Agent {
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        label: String,
    },
    Review {
        label: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskOutputMessage {
    pub role: TaskOutputRole,
    pub timestamp: String,
    pub sender: TaskOutputSender,
    pub text: String,
    #[serde(skip_serializing_if = "is_false")]
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskOutputPage {
    pub messages: Vec<TaskOutputMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum TaskOutputError {
    #[error("task-output limit must be between 1 and {MAX_TASK_OUTPUT_LIMIT}")]
    InvalidLimit,
    #[error("invalid task-output cursor")]
    InvalidCursor,
    #[error("task-output read failed")]
    Internal(#[source] anyhow::Error),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskOutputCursor {
    before_seq: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedCompletedEvent {
    #[serde(rename = "type")]
    event_type: String,
    item: PersistedVisibleItem,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedVisibleItem {
    kind: PersistedItemKind,
    status: PersistedItemStatus,
    source_agent_kind: String,
    #[serde(default, rename = "isTransient")]
    is_transient: bool,
    #[serde(default)]
    content_parts: Vec<PersistedContentPart>,
    prompt_provenance: Option<PersistedPromptProvenance>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum PersistedItemKind {
    UserMessage,
    AssistantMessage,
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum PersistedItemStatus {
    Completed,
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PersistedContentPart {
    Text {
        text: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum PersistedPromptProvenance {
    AgentSession {
        #[serde(rename = "sourceSessionId")]
        source_session_id: String,
        label: Option<String>,
    },
    SubagentWake {
        label: Option<String>,
    },
    LinkWake {
        label: Option<String>,
    },
    ReviewFeedback {
        label: Option<String>,
    },
    System {
        #[serde(rename = "label")]
        _label: Option<String>,
    },
    #[serde(other)]
    Other,
}

impl SessionService {
    pub fn get_task_output(
        &self,
        session_id: &str,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<TaskOutputPage, TaskOutputError> {
        read_task_output(self.store(), session_id, cursor, limit)
    }
}

fn read_task_output(
    store: &SessionStore,
    session_id: &str,
    cursor: Option<&str>,
    limit: usize,
) -> Result<TaskOutputPage, TaskOutputError> {
    if !(1..=MAX_TASK_OUTPUT_LIMIT).contains(&limit) {
        return Err(TaskOutputError::InvalidLimit);
    }

    let mut before_seq = cursor.map(decode_cursor).transpose()?.unwrap_or(i64::MAX);
    let mut messages = Vec::with_capacity(limit);
    let mut oldest_included_seq = None;
    let mut has_older_visible = false;
    let mut message_was_truncated = false;

    'batches: loop {
        let batch = store
            .list_completed_items_before_desc(session_id, before_seq, EVENT_BATCH_SIZE)
            .map_err(TaskOutputError::Internal)?;
        if batch.is_empty() {
            break;
        }
        before_seq = batch.last().map(|event| event.seq).unwrap_or(before_seq);
        let exhausted = batch.len() < EVENT_BATCH_SIZE as usize;

        for event in batch {
            let Some(mut projected) = project_visible_message(session_id, &event) else {
                continue;
            };
            if messages.len() >= limit {
                has_older_visible = true;
                break 'batches;
            }

            let seq = event.seq;
            let mut candidate = messages.clone();
            candidate.push(projected.clone());
            if serialized_page_size(&candidate, Some(seq), true) > MAX_TASK_OUTPUT_PAGE_BYTES {
                if messages.is_empty() {
                    truncate_message_to_page_budget(&mut projected, seq)?;
                    message_was_truncated = true;
                    messages.push(projected);
                    oldest_included_seq = Some(seq);
                    continue;
                }
                has_older_visible = true;
                break 'batches;
            }
            messages.push(projected);
            oldest_included_seq = Some(seq);
        }

        if exhausted {
            break;
        }
    }

    let next_cursor = if has_older_visible {
        oldest_included_seq.map(encode_cursor).transpose()?
    } else {
        None
    };
    messages.reverse();
    Ok(TaskOutputPage {
        messages,
        next_cursor,
        truncated: message_was_truncated || has_older_visible,
    })
}

fn project_visible_message(
    target_session_id: &str,
    record: &SessionEventRecord,
) -> Option<TaskOutputMessage> {
    let completed = serde_json::from_str::<PersistedCompletedEvent>(&record.payload_json).ok()?;
    if completed.event_type != "item_completed" {
        return None;
    }
    let item = completed.item;
    if item.is_transient || !matches!(item.status, PersistedItemStatus::Completed) {
        return None;
    }

    let (role, sender) = match item.kind {
        PersistedItemKind::AssistantMessage => (
            TaskOutputRole::Assistant,
            TaskOutputSender::Agent {
                session_id: Some(bounded(target_session_id, 128)),
                label: public_label(Some(&item.source_agent_kind), "Agent"),
            },
        ),
        PersistedItemKind::UserMessage => {
            let sender = project_user_sender(item.prompt_provenance.as_ref())?;
            (TaskOutputRole::User, sender)
        }
        PersistedItemKind::Other => return None,
    };
    let text = item
        .content_parts
        .into_iter()
        .filter_map(|part| match part {
            PersistedContentPart::Text { text } => Some(text),
            PersistedContentPart::Other => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        return None;
    }
    Some(TaskOutputMessage {
        role,
        timestamp: bounded(&record.timestamp, 64),
        sender,
        text,
        truncated: false,
    })
}

fn project_user_sender(provenance: Option<&PersistedPromptProvenance>) -> Option<TaskOutputSender> {
    match provenance {
        None => Some(TaskOutputSender::User {
            label: "User".into(),
        }),
        Some(PersistedPromptProvenance::AgentSession {
            source_session_id,
            label,
        }) => Some(TaskOutputSender::Agent {
            session_id: Some(bounded(source_session_id, 128)),
            label: public_label(label.as_deref(), "Agent"),
        }),
        Some(PersistedPromptProvenance::SubagentWake { label })
        | Some(PersistedPromptProvenance::LinkWake { label }) => Some(TaskOutputSender::Agent {
            session_id: None,
            label: public_label(label.as_deref(), "Agent update"),
        }),
        Some(PersistedPromptProvenance::ReviewFeedback { label }) => {
            Some(TaskOutputSender::Review {
                label: public_label(label.as_deref(), "Review feedback"),
            })
        }
        Some(PersistedPromptProvenance::System { .. } | PersistedPromptProvenance::Other) => None,
    }
}

fn truncate_message_to_page_budget(
    message: &mut TaskOutputMessage,
    seq: i64,
) -> Result<(), TaskOutputError> {
    let original = std::mem::take(&mut message.text);
    let mut low = 0usize;
    let mut high = original.len();
    while low < high {
        let midpoint = (low + high).div_ceil(2);
        let boundary = floor_char_boundary(&original, midpoint);
        message.text = format!("{}{}", &original[..boundary], TRUNCATION_MARKER);
        message.truncated = true;
        if serialized_page_size(std::slice::from_ref(message), Some(seq), true)
            <= MAX_TASK_OUTPUT_PAGE_BYTES
        {
            low = midpoint;
        } else {
            high = midpoint - 1;
        }
    }
    let boundary = floor_char_boundary(&original, low);
    message.text = format!("{}{}", &original[..boundary], TRUNCATION_MARKER);
    message.truncated = true;
    if serialized_page_size(std::slice::from_ref(message), Some(seq), true)
        > MAX_TASK_OUTPUT_PAGE_BYTES
    {
        return Err(TaskOutputError::Internal(anyhow::anyhow!(
            "task-output metadata exceeds page budget"
        )));
    }
    Ok(())
}

fn serialized_page_size(
    messages: &[TaskOutputMessage],
    oldest_seq: Option<i64>,
    truncated: bool,
) -> usize {
    let page = TaskOutputPage {
        messages: messages.to_vec(),
        next_cursor: oldest_seq.and_then(|seq| encode_cursor(seq).ok()),
        truncated,
    };
    serde_json::to_vec(&page).map_or(usize::MAX, |bytes| bytes.len())
}

fn encode_cursor(before_seq: i64) -> Result<String, TaskOutputError> {
    let bytes = serde_json::to_vec(&TaskOutputCursor { before_seq })
        .map_err(|error| TaskOutputError::Internal(error.into()))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_cursor(cursor: &str) -> Result<i64, TaskOutputError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(cursor)
        .map_err(|_| TaskOutputError::InvalidCursor)?;
    let decoded = serde_json::from_slice::<TaskOutputCursor>(&bytes)
        .map_err(|_| TaskOutputError::InvalidCursor)?;
    if decoded.before_seq <= 0 {
        return Err(TaskOutputError::InvalidCursor);
    }
    Ok(decoded.before_seq)
}

fn bounded(value: &str, max_bytes: usize) -> String {
    value[..floor_char_boundary(value, value.len().min(max_bytes))].to_string()
}

fn public_label(value: Option<&str>, fallback: &str) -> String {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    bounded(value.unwrap_or(fallback), 256)
}

fn floor_char_boundary(value: &str, mut index: usize) -> usize {
    index = index.min(value.len());
    while index > 0 && !value.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod tests;
