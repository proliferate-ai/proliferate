use serde::{Deserialize, Serialize};

use crate::anyharness_client::AnyHarnessClient;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot {
    pub active_session_count: u32,
    pub active_turn_count: u32,
    pub pending_interaction_count: u32,
    pub active_terminal_count: u32,
    pub active_process_count: u32,
    pub last_activity_at: Option<String>,
}

pub async fn collect(anyharness: &AnyHarnessClient) -> ActivitySnapshot {
    let Ok(value) = anyharness.runtime_activity().await else {
        return ActivitySnapshot::default();
    };

    ActivitySnapshot {
        active_session_count: number(&value, "activeSessionCount"),
        active_turn_count: number(&value, "activeTurnCount"),
        pending_interaction_count: number(&value, "pendingInteractionCount"),
        active_terminal_count: number(&value, "activeTerminalCount"),
        active_process_count: number(&value, "activeProcessCount"),
        last_activity_at: value
            .get("lastActivityAt")
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned),
    }
}

fn number(value: &serde_json::Value, key: &str) -> u32 {
    value
        .get(key)
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default()
        .min(u32::MAX as u64) as u32
}
