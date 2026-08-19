use agent_client_protocol as acp;
use anyharness_contract::v1::{
    ConfigApplyState, HarnessLaunchControl, HarnessLaunchControlValue, HarnessLaunchModel,
    PromptCapabilities, SessionLiveConfigCurrent, SessionLiveConfigSnapshot,
};

use crate::domains::sessions::model::SessionLiveConfigSnapshotRecord;

pub(crate) mod controls;
mod raw;
#[cfg(test)]
mod tests;

pub const ACP_MODEL_COMPAT_CONFIG_ID: &str = "model";
pub const LEGACY_MODE_COMPAT_CONFIG_ID: &str = "mode";

/// Sessions-owned effective live-config vocabulary for application domains.
/// Contract fidelity remains inside sessions; consumers receive only the
/// normalized ids and values that a later mutation can validate and apply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveLiveConfigValue {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveLiveConfigControl {
    pub key: String,
    pub config_id: String,
    pub label: String,
    pub current_value: Option<String>,
    pub settable: bool,
    pub values: Vec<EffectiveLiveConfigValue>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveLiveConfigSnapshot {
    pub controls: Vec<EffectiveLiveConfigControl>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectiveConfigApplyState {
    Applied,
    Queued,
}

pub fn effective_config_apply_state(state: ConfigApplyState) -> EffectiveConfigApplyState {
    match state {
        ConfigApplyState::Applied => EffectiveConfigApplyState::Applied,
        ConfigApplyState::Queued => EffectiveConfigApplyState::Queued,
    }
}

pub fn effective_live_config_snapshot(
    snapshot: SessionLiveConfigSnapshot,
) -> EffectiveLiveConfigSnapshot {
    let controls = snapshot.normalized_controls;
    let mut normalized = Vec::new();
    normalized.extend(controls.model);
    normalized.extend(controls.collaboration_mode);
    normalized.extend(controls.reasoning);
    normalized.extend(controls.effort);
    normalized.extend(controls.fast_mode);
    normalized.extend(controls.mode);
    normalized.extend(controls.extras);
    EffectiveLiveConfigSnapshot {
        controls: normalized
            .into_iter()
            .map(|control| EffectiveLiveConfigControl {
                key: control.key,
                config_id: control.raw_config_id,
                label: control.label,
                current_value: control.current_value,
                settable: control.settable,
                values: control
                    .values
                    .into_iter()
                    .map(|value| EffectiveLiveConfigValue {
                        value: value.value,
                        label: value.label,
                        description: value.description,
                    })
                    .collect(),
            })
            .collect(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionModelOption {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyModeOption {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyModeState {
    pub current_mode_id: String,
    pub available_modes: Vec<LegacyModeOption>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NormalizedControlKind {
    Model,
    CollaborationMode,
    Mode,
    Reasoning,
    Effort,
    FastMode,
    Extra,
}

const NORMALIZED_ORDER: &[NormalizedControlKind] = &[
    NormalizedControlKind::Model,
    NormalizedControlKind::CollaborationMode,
    NormalizedControlKind::Reasoning,
    NormalizedControlKind::Effort,
    NormalizedControlKind::FastMode,
    NormalizedControlKind::Mode,
];

pub fn build_live_config_snapshot(
    _agent_kind: &str,
    config_options: &[acp::schema::SessionConfigOption],
    current_model_id: Option<&str>,
    available_models: &[SessionModelOption],
    legacy_mode_state: Option<&LegacyModeState>,
    prompt_capabilities: PromptCapabilities,
    source_seq: i64,
    updated_at: String,
) -> SessionLiveConfigSnapshot {
    let raw_config_options = config_options
        .iter()
        .filter_map(raw::into_raw_option)
        .collect::<Vec<_>>();
    let normalized_controls = controls::normalize_controls(
        &raw_config_options,
        current_model_id,
        available_models,
        legacy_mode_state,
    );
    let models = available_models
        .iter()
        .map(|model| HarnessLaunchModel {
            id: model.id.clone(),
            observed_name: Some(model.name.clone()),
            observed_description: model.description.clone(),
        })
        .collect::<Vec<_>>();
    let mut live_controls = raw_config_options
        .iter()
        .filter(|option| {
            option.id != ACP_MODEL_COMPAT_CONFIG_ID && option.category.as_deref() != Some("model")
        })
        .map(|option| HarnessLaunchControl {
            id: option.id.clone(),
            observed_label: Some(option.name.clone()),
            observed_description: option.description.clone(),
            values: option
                .options
                .iter()
                .map(|value| HarnessLaunchControlValue {
                    value: value.value.clone(),
                    observed_label: Some(value.name.clone()),
                    observed_description: value.description.clone(),
                })
                .collect(),
        })
        .collect::<Vec<_>>();
    if !live_controls.iter().any(|control| control.id == LEGACY_MODE_COMPAT_CONFIG_ID) {
        if let Some(legacy) = legacy_mode_state {
            live_controls.push(HarnessLaunchControl {
                id: LEGACY_MODE_COMPAT_CONFIG_ID.to_string(),
                observed_label: Some("Mode".to_string()),
                observed_description: None,
                values: legacy
                    .available_modes
                    .iter()
                    .map(|value| HarnessLaunchControlValue {
                        value: value.id.clone(),
                        observed_label: Some(value.name.clone()),
                        observed_description: value.description.clone(),
                    })
                    .collect(),
            });
        }
    }
    let mut current_control_values = raw_config_options
        .iter()
        .filter(|option| {
            option.id != ACP_MODEL_COMPAT_CONFIG_ID && option.category.as_deref() != Some("model")
        })
        .map(|option| (option.id.clone(), option.current_value.clone()))
        .collect::<std::collections::BTreeMap<_, _>>();
    if let Some(legacy) = legacy_mode_state {
        current_control_values
            .entry(LEGACY_MODE_COMPAT_CONFIG_ID.to_string())
            .or_insert_with(|| legacy.current_mode_id.clone());
    }

    SessionLiveConfigSnapshot {
        models,
        controls: live_controls,
        current: SessionLiveConfigCurrent {
            model_id: normalized_controls
                .model
                .as_ref()
                .and_then(|control| control.current_value.clone())
                .or_else(|| current_model_id.map(str::to_string)),
            control_values: current_control_values,
        },
        raw_config_options,
        normalized_controls,
        prompt_capabilities,
        source_seq,
        updated_at,
    }
}

pub fn normalized_key_rank(key: NormalizedControlKind) -> usize {
    NORMALIZED_ORDER
        .iter()
        .position(|candidate| *candidate == key)
        .unwrap_or(usize::MAX)
}

pub fn snapshot_to_record(
    session_id: &str,
    snapshot: &SessionLiveConfigSnapshot,
) -> anyhow::Result<SessionLiveConfigSnapshotRecord> {
    Ok(SessionLiveConfigSnapshotRecord {
        session_id: session_id.to_string(),
        source_seq: snapshot.source_seq,
        raw_config_options_json: serde_json::to_string(&snapshot.raw_config_options)?,
        normalized_controls_json: serde_json::to_string(&snapshot.normalized_controls)?,
        prompt_capabilities_json: Some(serde_json::to_string(&snapshot.prompt_capabilities)?),
        full_snapshot_json: Some(serde_json::to_string(snapshot)?),
        updated_at: snapshot.updated_at.clone(),
    })
}

pub fn snapshot_from_record(
    record: &SessionLiveConfigSnapshotRecord,
) -> anyhow::Result<SessionLiveConfigSnapshot> {
    if let Some(full_snapshot_json) = record.full_snapshot_json.as_deref() {
        return Ok(serde_json::from_str(full_snapshot_json)?);
    }
    Ok(SessionLiveConfigSnapshot {
        models: Vec::new(),
        controls: Vec::new(),
        current: SessionLiveConfigCurrent::default(),
        raw_config_options: serde_json::from_str(&record.raw_config_options_json)?,
        normalized_controls: serde_json::from_str(&record.normalized_controls_json)?,
        prompt_capabilities: record
            .prompt_capabilities_json
            .as_deref()
            .map(serde_json::from_str)
            .transpose()?
            .unwrap_or_default(),
        source_seq: record.source_seq,
        updated_at: record.updated_at.clone(),
    })
}
