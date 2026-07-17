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
                "models": agent.models.into_iter().map(|model| {
                    json!({
                        "modelId": model.id,
                        "displayName": model.display_name,
                        "isDefault": model.is_default,
                    })
                }).collect::<Vec<_>>(),
                "recommendedModeId": agent.unattended_mode_id,
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

pub(super) fn recommended_modes_by_agent_kind_json(
    catalog: &ResolvedWorkspaceLaunchOptions,
) -> Value {
    Value::Object(
        catalog
            .agents
            .iter()
            .filter_map(|agent| {
                agent
                    .unattended_mode_id
                    .as_ref()
                    .map(|mode_id| (agent.kind.clone(), Value::String(mode_id.clone())))
            })
            .collect(),
    )
}

pub(super) fn unattended_mode_for_agent(
    catalog: &ResolvedWorkspaceLaunchOptions,
    agent_kind: &str,
) -> Option<String> {
    catalog
        .agents
        .iter()
        .find(|agent| agent.kind == agent_kind)
        .and_then(|agent| agent.unattended_mode_id.clone())
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

pub(super) fn coding_session_workspace_id(
    cowork_runtime: &CoworkRuntime,
    coding_session_id: &str,
) -> anyhow::Result<Option<String>> {
    Ok(cowork_runtime
        .session_record(coding_session_id)?
        .map(|session| session.workspace_id))
}

#[cfg(test)]
mod tests {
    use super::unattended_mode_for_agent;
    use crate::domains::agents::readiness::launch_options::{
        ResolvedLaunchAgentOption, ResolvedWorkspaceLaunchOptions,
    };

    #[test]
    fn agent_without_unattended_catalog_curation_has_no_recommended_mode() {
        let catalog = ResolvedWorkspaceLaunchOptions {
            agents: vec![ResolvedLaunchAgentOption {
                kind: "grok".to_string(),
                display_name: "Grok".to_string(),
                default_model_id: Some("grok-4".to_string()),
                unattended_mode_id: None,
                models: Vec::new(),
            }],
        };

        assert_eq!(unattended_mode_for_agent(&catalog, "grok"), None);
    }
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
