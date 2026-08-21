use serde_json::{json, Value};

use std::collections::BTreeMap;

use crate::domains::agents::launch_options::{HarnessLaunchOptions, HarnessLaunchOptionsResponse};
use crate::domains::cowork::runtime::CoworkRuntime;
use crate::domains::sessions::links::model::SessionLinkRecord;
use crate::domains::sessions::runtime::SendPromptOutcome;

pub(super) fn launch_options_to_json(
    launch_options: Vec<HarnessLaunchOptionsResponse>,
) -> Vec<Value> {
    launch_options
        .into_iter()
        .map(|response| json!(response))
        .collect()
}

pub(super) fn default_launch_selection(
    options: &HarnessLaunchOptions,
) -> (Option<String>, BTreeMap<String, String>) {
    let model_id = options.defaults.model_id.clone();
    let control_values = model_id
        .as_deref()
        .and_then(|id| {
            options
                .model_controls
                .iter()
                .find(|scope| scope.model_id == id)
        })
        .map(|scope| scope.default_control_values.clone())
        .unwrap_or_else(|| options.defaults.control_values.clone());
    (model_id, control_values)
}

pub(super) fn prompt_outcome_label(outcome: &SendPromptOutcome) -> &'static str {
    match outcome {
        SendPromptOutcome::Running { .. } => "running",
        SendPromptOutcome::Queued { .. } => "queued",
    }
}

pub(super) fn coding_session_workspace_id(
    cowork_runtime: &CoworkRuntime,
    coding_session_id: &str,
) -> anyhow::Result<Option<String>> {
    Ok(cowork_runtime
        .session_record(coding_session_id)?
        .map(|session| session.workspace_id))
}

pub(super) fn cowork_agent_turns_response_json(
    link: &SessionLinkRecord,
    turns: Vec<Value>,
) -> Value {
    json!({
        "coworkAgentId": link.public_id,
        "codingSessionId": link.child_session_id,
        "sessionLinkId": link.id,
        "label": link.label,
        "turns": turns,
    })
}

pub(super) fn cowork_agent_search_response_json(
    link: &SessionLinkRecord,
    query: String,
    matches: Vec<Value>,
) -> Value {
    json!({
        "coworkAgentId": link.public_id,
        "codingSessionId": link.child_session_id,
        "sessionLinkId": link.id,
        "label": link.label,
        "query": query,
        "matches": matches,
    })
}
