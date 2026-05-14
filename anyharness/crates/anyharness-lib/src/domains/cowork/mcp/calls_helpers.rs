use serde_json::{json, Value};

use crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions;
use crate::domains::cowork::runtime::default_cowork_coding_mode_for_agent;
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

pub(super) fn non_empty(value: String) -> Option<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
