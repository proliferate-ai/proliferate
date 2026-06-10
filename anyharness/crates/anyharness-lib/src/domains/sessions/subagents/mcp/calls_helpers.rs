use serde_json::{json, Value};

use crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions;
use crate::domains::sessions::runtime::SendPromptOutcome;

pub(super) fn default_model_for_agent(
    catalog: &ResolvedWorkspaceLaunchOptions,
    agent_kind: &str,
) -> Option<String> {
    catalog
        .agents
        .iter()
        .find(|agent| agent.kind == agent_kind)
        .and_then(|agent| agent.default_model_id.clone())
}

pub(super) fn launch_agents_to_json(
    catalog: ResolvedWorkspaceLaunchOptions,
    parent_agent_kind: &str,
) -> Vec<Value> {
    catalog
        .agents
        .into_iter()
        .map(|agent| {
            json!({
                "agentKind": agent.kind,
                "displayName": agent.display_name,
                "defaultModelId": agent.default_model_id,
                "isParentAgent": agent.kind == parent_agent_kind,
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

pub(super) fn mode_options_to_json(
    mode_control: Option<&anyharness_contract::v1::NormalizedSessionControl>,
) -> Vec<Value> {
    mode_control
        .map(|control| {
            control
                .values
                .iter()
                .map(|value| {
                    json!({
                        "modeId": value.value,
                        "label": value.label,
                        "description": value.description,
                        "isCurrent": control.current_value.as_deref() == Some(value.value.as_str()),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn summaries_to_json(
    summaries: Vec<super::super::model::SubagentSummary>,
) -> Vec<Value> {
    summaries
        .into_iter()
        .map(|summary| {
            json!({
                "sessionLinkId": summary.link_id,
                "subagentId": summary.subagent_id,
                "childSessionId": summary.child_session_id,
                "label": summary.label,
                "status": summary.status,
                "agentKind": summary.agent_kind,
                "modelId": summary.model_id,
                "modeId": summary.mode_id,
                "createdAt": summary.created_at,
                "closedAt": summary.closed_at,
            })
        })
        .collect()
}

pub(super) fn initial_config_string(config: Option<&Value>, keys: &[&str]) -> Option<String> {
    let config = config?;
    keys.iter().find_map(|key| {
        config
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

pub(super) fn prompt_outcome_label(outcome: &SendPromptOutcome) -> &'static str {
    match outcome {
        SendPromptOutcome::Running { .. } => "running",
        SendPromptOutcome::Queued { .. } => "queued",
    }
}
