use serde_json::{json, Value};

use crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions;
use crate::domains::cowork::runtime::{default_cowork_coding_mode_for_agent, CoworkRuntime};
use crate::sessions::links::model::SessionLinkRecord;
use crate::sessions::runtime::SendPromptOutcome;

pub(super) fn launch_agents_to_json(catalog: ResolvedWorkspaceLaunchOptions) -> Vec<Value> {
    catalog
        .agents
        .into_iter()
        .map(|agent| {
            json!({
                "agentKind": agent.kind,
                "displayName": agent.display_name,
                "defaultModelId": agent.default_model_id,
                "models": agent.models.into_iter().map(|model| {
                    json!({
                        "modelId": model.id,
                        "displayName": model.display_name,
                        "isDefault": model.is_default,
                    })
                }).collect::<Vec<_>>(),
                "recommendedModeId": default_cowork_coding_mode_for_agent(&agent.kind),
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

pub(super) fn recommended_modes_by_agent_kind_json() -> Value {
    json!({
        "claude": "bypassPermissions",
        "codex": "full-access",
        "gemini": "yolo",
    })
}

pub(super) fn prompt_outcome_label(outcome: &SendPromptOutcome) -> &'static str {
    match outcome {
        SendPromptOutcome::Running { .. } => "running",
        SendPromptOutcome::Queued { .. } => "queued",
    }
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

pub(super) fn resolve_preferred_string(
    preferred: Option<&str>,
    legacy: Option<&str>,
    preferred_name: &str,
    legacy_name: &str,
) -> anyhow::Result<Option<String>> {
    let preferred = preferred.map(str::trim).filter(|value| !value.is_empty());
    let legacy = legacy.map(str::trim).filter(|value| !value.is_empty());
    if let (Some(left), Some(right)) = (preferred, legacy) {
        if left != right {
            anyhow::bail!("{preferred_name} conflicts with deprecated {legacy_name}");
        }
    }
    Ok(preferred.or(legacy).map(ToString::to_string))
}

pub(super) fn non_empty(value: String) -> Option<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
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
