use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::anyharness_client::runtime::PrepareStopRequest;
use crate::anyharness_client::AnyHarnessClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeStopSnapshot {
    pub state: SafeStopState,
    pub blockers: Vec<String>,
    pub details: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SafeStopState {
    Safe,
    Blocked,
    Unknown,
}

pub async fn collect(anyharness: &AnyHarnessClient) -> SafeStopSnapshot {
    assess_workspace(anyharness, None).await
}

pub async fn assess_workspace(
    anyharness: &AnyHarnessClient,
    workspace_id: Option<String>,
) -> SafeStopSnapshot {
    match anyharness
        .prepare_stop(&PrepareStopRequest {
            workspace_id,
            force: false,
        })
        .await
    {
        Ok(value) => from_prepare_stop_value(value),
        Err(error) => SafeStopSnapshot {
            state: SafeStopState::Unknown,
            blockers: vec!["prepare_stop_unavailable".to_string()],
            details: json!({ "error": error.to_string() }),
        },
    }
}

fn from_prepare_stop_value(value: serde_json::Value) -> SafeStopSnapshot {
    let state = value
        .get("safeStopState")
        .or_else(|| value.get("state"))
        .and_then(serde_json::Value::as_str)
        .map(|state| match state {
            "safe" => SafeStopState::Safe,
            "blocked" => SafeStopState::Blocked,
            _ => SafeStopState::Unknown,
        })
        .or_else(|| {
            value
                .get("canStop")
                .and_then(serde_json::Value::as_bool)
                .map(|can_stop| {
                    if can_stop {
                        SafeStopState::Safe
                    } else {
                        SafeStopState::Blocked
                    }
                })
        })
        .unwrap_or(SafeStopState::Unknown);

    let blockers = value
        .get("blockers")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.as_str().map(ToOwned::to_owned).or_else(|| {
                        item.get("code")
                            .and_then(serde_json::Value::as_str)
                            .map(ToOwned::to_owned)
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    SafeStopSnapshot {
        state,
        blockers,
        details: value,
    }
}
