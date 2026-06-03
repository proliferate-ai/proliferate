use anyharness_contract::v1::{
    NormalizedSessionControl, NormalizedSessionControlValue, NormalizedSessionControls,
    RawSessionConfigOption,
};

use super::{
    LegacyModeState, NormalizedControlKind, SessionModelOption, ACP_MODEL_COMPAT_CONFIG_ID,
    LEGACY_MODE_COMPAT_CONFIG_ID,
};

pub(super) fn normalize_controls(
    raw_options: &[RawSessionConfigOption],
    current_model_id: Option<&str>,
    available_models: &[SessionModelOption],
    legacy_mode_state: Option<&LegacyModeState>,
) -> NormalizedSessionControls {
    let mut claimed = vec![false; raw_options.len()];
    let model = claim_control(raw_options, &mut claimed, NormalizedControlKind::Model)
        .or_else(|| into_acp_model_control(current_model_id, available_models));
    let collaboration_mode = claim_control(
        raw_options,
        &mut claimed,
        NormalizedControlKind::CollaborationMode,
    );
    let mode = claim_control(raw_options, &mut claimed, NormalizedControlKind::Mode)
        .or_else(|| legacy_mode_state.and_then(into_legacy_mode_control));
    let reasoning = claim_control(raw_options, &mut claimed, NormalizedControlKind::Reasoning);
    let effort = claim_control(raw_options, &mut claimed, NormalizedControlKind::Effort);
    let fast_mode = claim_control(raw_options, &mut claimed, NormalizedControlKind::FastMode);

    let extras = raw_options
        .iter()
        .enumerate()
        .filter(|(index, _)| !claimed[*index])
        .map(|(_, option)| into_normalized_control(option, None))
        .collect();

    NormalizedSessionControls {
        model,
        collaboration_mode,
        mode,
        reasoning,
        effort,
        fast_mode,
        extras,
    }
}

fn claim_control(
    raw_options: &[RawSessionConfigOption],
    claimed: &mut [bool],
    key: NormalizedControlKind,
) -> Option<NormalizedSessionControl> {
    let index = raw_options
        .iter()
        .enumerate()
        .find(|(idx, option)| !claimed[*idx] && option_matches_key(option, key))
        .map(|(idx, _)| idx)?;
    claimed[index] = true;
    Some(into_normalized_control(&raw_options[index], Some(key)))
}

fn into_acp_model_control(
    current_model_id: Option<&str>,
    available_models: &[SessionModelOption],
) -> Option<NormalizedSessionControl> {
    if current_model_id.is_none() && available_models.is_empty() {
        return None;
    }

    let mut values = available_models
        .iter()
        .map(|model| NormalizedSessionControlValue {
            value: model.id.clone(),
            label: model.name.clone(),
            description: model.description.clone(),
        })
        .collect::<Vec<_>>();

    if let Some(current_model_id) = current_model_id {
        if !values.iter().any(|value| value.value == current_model_id) {
            values.push(NormalizedSessionControlValue {
                value: current_model_id.to_string(),
                label: current_model_id.to_string(),
                description: None,
            });
        }
    }

    Some(NormalizedSessionControl {
        key: "model".to_string(),
        raw_config_id: ACP_MODEL_COMPAT_CONFIG_ID.to_string(),
        label: "Model".to_string(),
        current_value: current_model_id.map(str::to_string),
        settable: values.len() > 1,
        values,
    })
}

fn into_legacy_mode_control(
    legacy_mode_state: &LegacyModeState,
) -> Option<NormalizedSessionControl> {
    if legacy_mode_state.available_modes.is_empty() {
        return None;
    }

    let values = legacy_mode_state
        .available_modes
        .iter()
        .map(|mode| NormalizedSessionControlValue {
            value: mode.id.clone(),
            label: mode.name.clone(),
            description: mode.description.clone(),
        })
        .collect::<Vec<_>>();

    Some(NormalizedSessionControl {
        key: "mode".to_string(),
        raw_config_id: LEGACY_MODE_COMPAT_CONFIG_ID.to_string(),
        label: "Mode".to_string(),
        current_value: Some(legacy_mode_state.current_mode_id.clone()),
        settable: values.len() > 1,
        values,
    })
}

pub(crate) fn option_matches_key(
    option: &RawSessionConfigOption,
    key: NormalizedControlKind,
) -> bool {
    let label = format!("{} {}", option.id, option.name).to_ascii_lowercase();
    match key {
        NormalizedControlKind::Model => {
            option.category.as_deref() == Some("model") || label.contains("model")
        }
        NormalizedControlKind::CollaborationMode => {
            option.category.as_deref() == Some("collaboration_mode")
                || option.id == "collaboration_mode"
        }
        NormalizedControlKind::Mode => {
            (option.category.as_deref() == Some("mode")
                || label.contains("mode")
                || label.contains("approval"))
                && option.category.as_deref() != Some("collaboration_mode")
                && option.category.as_deref() != Some("fast_mode")
                && option.id != "collaboration_mode"
                && option.id != "fast_mode"
        }
        NormalizedControlKind::Effort => {
            option.category.as_deref() == Some("thought_level")
                || label.contains("reasoning_effort")
                || label.contains("effort")
                || label.contains("intensity")
        }
        NormalizedControlKind::Reasoning => {
            label.contains("thinking")
                || label.contains("adaptive_thinking")
                || label.contains("always_thinking")
                || label.contains("reasoning_toggle")
        }
        NormalizedControlKind::FastMode => {
            option.category.as_deref() == Some("fast_mode")
                || option.id == "fast_mode"
                || label.contains("fast_mode")
                || label.contains("fast mode")
        }
        NormalizedControlKind::Extra => false,
    }
}

fn into_normalized_control(
    option: &RawSessionConfigOption,
    key: Option<NormalizedControlKind>,
) -> NormalizedSessionControl {
    let normalized_key = key.unwrap_or_else(|| infer_extra_key(option));
    let values: Vec<NormalizedSessionControlValue> = option
        .options
        .iter()
        .map(|value| NormalizedSessionControlValue {
            value: value.value.clone(),
            label: value.name.clone(),
            description: value.description.clone(),
        })
        .collect();

    NormalizedSessionControl {
        key: key_to_string(normalized_key, option),
        raw_config_id: option.id.clone(),
        label: option.name.clone(),
        current_value: Some(option.current_value.clone()),
        settable: values.len() > 1,
        values,
    }
}

fn infer_extra_key(_option: &RawSessionConfigOption) -> NormalizedControlKind {
    NormalizedControlKind::Extra
}

fn key_to_string(key: NormalizedControlKind, option: &RawSessionConfigOption) -> String {
    match key {
        NormalizedControlKind::Model => "model".to_string(),
        NormalizedControlKind::CollaborationMode => "collaboration_mode".to_string(),
        NormalizedControlKind::Mode => "mode".to_string(),
        NormalizedControlKind::Reasoning => "reasoning".to_string(),
        NormalizedControlKind::Effort => "effort".to_string(),
        NormalizedControlKind::FastMode => "fast_mode".to_string(),
        NormalizedControlKind::Extra => format!("extra:{}", option.id),
    }
}
