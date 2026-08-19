use serde_json::{json, Value};

use crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions;
use crate::domains::cowork::runtime::CoworkRuntime;
use crate::domains::sessions::links::model::SessionLinkRecord;
use crate::domains::sessions::runtime::SendPromptOutcome;

pub(super) fn launch_agents_to_json(catalog: ResolvedWorkspaceLaunchOptions) -> Vec<Value> {
    catalog
        .agents
        .into_iter()
        .map(|agent| {
            json!({
                "agentKind": agent.kind,
                "displayName": agent.display_name,
                "defaultModelId": agent.default_model_id,
                "controls": agent.controls,
                "defaultControlValues": agent.default_control_values,
                "models": agent.models.into_iter().map(|model| {
                    json!({
                        "modelId": model.id,
                        "displayName": model.display_name,
                        "isDefault": model.is_default,
                    })
                }).collect::<Vec<_>>(),
            })
        })
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
