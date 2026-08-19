use serde_json::{json, Value};

use crate::domains::agents::launch_options::HarnessLaunchOptionsResponse;
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
