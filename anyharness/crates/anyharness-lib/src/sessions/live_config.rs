use agent_client_protocol as acp;
use anyharness_contract::v1::{
    NormalizedSessionControl, NormalizedSessionControlValue, NormalizedSessionControls,
    RawSessionConfigOption, RawSessionConfigValue, SessionConfigOptionType,
    SessionLiveConfigSnapshot,
};

use crate::sessions::model::SessionLiveConfigSnapshotRecord;

pub const LEGACY_MODE_COMPAT_CONFIG_ID: &str = "mode";

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
    config_options: &[acp::SessionConfigOption],
    legacy_mode_state: Option<&LegacyModeState>,
    source_seq: i64,
    updated_at: String,
) -> SessionLiveConfigSnapshot {
    let raw_config_options = config_options
        .iter()
        .filter_map(into_raw_option)
        .collect::<Vec<_>>();
    let normalized_controls = normalize_controls(&raw_config_options, legacy_mode_state);

    SessionLiveConfigSnapshot {
        raw_config_options,
        normalized_controls,
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
        updated_at: snapshot.updated_at.clone(),
    })
}

pub fn snapshot_from_record(
    record: &SessionLiveConfigSnapshotRecord,
) -> anyhow::Result<SessionLiveConfigSnapshot> {
    Ok(SessionLiveConfigSnapshot {
        raw_config_options: serde_json::from_str(&record.raw_config_options_json)?,
        normalized_controls: serde_json::from_str(&record.normalized_controls_json)?,
        source_seq: record.source_seq,
        updated_at: record.updated_at.clone(),
    })
}

fn normalize_controls(
    raw_options: &[RawSessionConfigOption],
    legacy_mode_state: Option<&LegacyModeState>,
) -> NormalizedSessionControls {
    let mut claimed = vec![false; raw_options.len()];
    let model = claim_control(raw_options, &mut claimed, NormalizedControlKind::Model);
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

fn into_raw_option(option: &acp::SessionConfigOption) -> Option<RawSessionConfigOption> {
    let acp::SessionConfigKind::Select(select) = &option.kind else {
        return None;
    };

    Some(RawSessionConfigOption {
        id: option.id.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
        category: option.category.as_ref().map(category_to_string),
        option_type: SessionConfigOptionType::Select,
        current_value: select.current_value.to_string(),
        options: flatten_select_options(&select.options),
    })
}

fn flatten_select_options(options: &acp::SessionConfigSelectOptions) -> Vec<RawSessionConfigValue> {
    match options {
        acp::SessionConfigSelectOptions::Ungrouped(options) => {
            options.iter().map(into_raw_value).collect()
        }
        acp::SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|group| group.options.iter().map(into_raw_value))
            .collect(),
        _ => Vec::new(),
    }
}

fn into_raw_value(option: &acp::SessionConfigSelectOption) -> RawSessionConfigValue {
    RawSessionConfigValue {
        value: option.value.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
    }
}

fn category_to_string(category: &acp::SessionConfigOptionCategory) -> String {
    match category {
        acp::SessionConfigOptionCategory::Mode => "mode".to_string(),
        acp::SessionConfigOptionCategory::Model => "model".to_string(),
        acp::SessionConfigOptionCategory::ThoughtLevel => "thought_level".to_string(),
        acp::SessionConfigOptionCategory::Other(other) => other.clone(),
        _ => "unknown".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model_option(values: &[&str]) -> RawSessionConfigOption {
        RawSessionConfigOption {
            id: "model".into(),
            name: "Model".into(),
            description: None,
            category: Some("model".into()),
            option_type: SessionConfigOptionType::Select,
            current_value: values.first().copied().unwrap_or_default().to_string(),
            options: values
                .iter()
                .map(|value| RawSessionConfigValue {
                    value: (*value).to_string(),
                    name: (*value).to_string(),
                    description: None,
                })
                .collect(),
        }
    }

    fn effort_option(values: &[&str]) -> RawSessionConfigOption {
        RawSessionConfigOption {
            id: "effort".into(),
            name: "Effort".into(),
            description: None,
            category: Some("thought_level".into()),
            option_type: SessionConfigOptionType::Select,
            current_value: values.first().copied().unwrap_or_default().to_string(),
            options: values
                .iter()
                .map(|value| RawSessionConfigValue {
                    value: (*value).to_string(),
                    name: (*value).to_string(),
                    description: None,
                })
                .collect(),
        }
    }

    fn mode_option(values: &[&str]) -> RawSessionConfigOption {
        RawSessionConfigOption {
            id: "approval_mode".into(),
            name: "Mode".into(),
            description: None,
            category: Some("mode".into()),
            option_type: SessionConfigOptionType::Select,
            current_value: values.first().copied().unwrap_or_default().to_string(),
            options: values
                .iter()
                .map(|value| RawSessionConfigValue {
                    value: (*value).to_string(),
                    name: (*value).to_string(),
                    description: None,
                })
                .collect(),
        }
    }

    fn legacy_mode_state(values: &[(&str, &str)]) -> LegacyModeState {
        LegacyModeState {
            current_mode_id: values
                .first()
                .map(|(id, _)| (*id).to_string())
                .unwrap_or_default(),
            available_modes: values
                .iter()
                .map(|(id, name)| LegacyModeOption {
                    id: (*id).to_string(),
                    name: (*name).to_string(),
                    description: None,
                })
                .collect(),
        }
    }
    #[test]
    fn normalize_controls_preserves_all_live_model_values() {
        let controls = normalize_controls(
            &[model_option(&["default", "sonnet", "sonnet[1m]", "haiku"])],
            None,
        );

        let model = controls.model.expect("model control");
        let values = model
            .values
            .into_iter()
            .map(|value| value.value)
            .collect::<Vec<_>>();

        assert_eq!(values, vec!["default", "sonnet", "sonnet[1m]", "haiku"]);
    }

    #[test]
    fn normalize_controls_preserves_uncurated_live_model_values() {
        let controls = normalize_controls(
            &[model_option(&["default", "sonnet", "unlisted-live-model"])],
            None,
        );

        let model = controls.model.expect("model control");
        let values = model
            .values
            .into_iter()
            .map(|value| value.value)
            .collect::<Vec<_>>();

        assert_eq!(values, vec!["default", "sonnet", "unlisted-live-model"]);
    }

    #[test]
    fn normalize_controls_preserves_effort_values_including_max() {
        let controls = normalize_controls(&[effort_option(&["low", "high", "max"])], None);

        let effort = controls.effort.expect("effort control");
        let values = effort
            .values
            .into_iter()
            .map(|value| value.value)
            .collect::<Vec<_>>();

        assert_eq!(values, vec!["low", "high", "max"]);
    }

    #[test]
    fn normalize_controls_synthesizes_legacy_mode_when_no_raw_mode_option_exists() {
        let controls = normalize_controls(
            &[model_option(&["default", "sonnet"])],
            Some(&legacy_mode_state(&[
                ("default", "Default"),
                ("auto_edit", "Auto Edit"),
            ])),
        );

        let mode = controls.mode.expect("mode control");
        let values = mode
            .values
            .into_iter()
            .map(|value| value.value)
            .collect::<Vec<_>>();

        assert_eq!(mode.raw_config_id, LEGACY_MODE_COMPAT_CONFIG_ID);
        assert_eq!(mode.current_value.as_deref(), Some("default"));
        assert_eq!(values, vec!["default", "auto_edit"]);
    }

    #[test]
    fn normalize_controls_prefers_raw_mode_option_over_legacy_modes() {
        let controls = normalize_controls(
            &[
                model_option(&["default", "sonnet"]),
                mode_option(&["ask", "code"]),
            ],
            Some(&legacy_mode_state(&[
                ("default", "Default"),
                ("auto_edit", "Auto Edit"),
            ])),
        );

        let mode = controls.mode.expect("mode control");

        assert_eq!(mode.raw_config_id, "approval_mode");
        assert_eq!(mode.current_value.as_deref(), Some("ask"));
    }

    #[test]
    fn normalize_controls_detects_mode_from_approval_label_without_mode_category() {
        let controls = normalize_controls(
            &[RawSessionConfigOption {
                id: "approval_preset".into(),
                name: "Approval Preset".into(),
                description: None,
                category: Some("other".into()),
                option_type: SessionConfigOptionType::Select,
                current_value: "auto".into(),
                options: vec![
                    RawSessionConfigValue {
                        value: "read-only".into(),
                        name: "Read Only".into(),
                        description: None,
                    },
                    RawSessionConfigValue {
                        value: "auto".into(),
                        name: "Auto".into(),
                        description: None,
                    },
                ],
            }],
            None,
        );

        let mode = controls.mode.expect("mode control");
        assert_eq!(mode.raw_config_id, "approval_preset");
        assert_eq!(mode.current_value.as_deref(), Some("auto"));
    }

    #[test]
    fn build_live_config_snapshot_keeps_raw_options_exact_when_mode_is_synthesized() {
        let mut model = acp::SessionConfigOption::select(
            "provider_model",
            "Model",
            "default",
            vec![
                acp::SessionConfigSelectOption::new("default", "Default"),
                acp::SessionConfigSelectOption::new("sonnet", "Sonnet"),
            ],
        );
        model.category = Some(acp::SessionConfigOptionCategory::Model);

        let snapshot = build_live_config_snapshot(
            "gemini",
            &[model],
            Some(&legacy_mode_state(&[
                ("default", "Default"),
                ("auto_edit", "Auto Edit"),
            ])),
            1,
            "2026-04-01T00:00:00Z".into(),
        );

        assert_eq!(snapshot.raw_config_options.len(), 1);
        assert_eq!(snapshot.raw_config_options[0].id, "provider_model");
        assert_eq!(
            snapshot
                .normalized_controls
                .mode
                .as_ref()
                .map(|control| control.raw_config_id.as_str()),
            Some(LEGACY_MODE_COMPAT_CONFIG_ID)
        );
    }

    #[test]
    fn normalize_controls_keeps_collaboration_mode_distinct_from_mode() {
        let controls = normalize_controls(
            &[
                RawSessionConfigOption {
                    id: "collaboration_mode".into(),
                    name: "Collaboration Mode".into(),
                    description: None,
                    category: Some("collaboration_mode".into()),
                    option_type: SessionConfigOptionType::Select,
                    current_value: "plan".into(),
                    options: vec![
                        RawSessionConfigValue {
                            value: "default".into(),
                            name: "Default".into(),
                            description: None,
                        },
                        RawSessionConfigValue {
                            value: "plan".into(),
                            name: "Plan".into(),
                            description: None,
                        },
                    ],
                },
                RawSessionConfigOption {
                    id: "mode".into(),
                    name: "Approval Preset".into(),
                    description: None,
                    category: Some("mode".into()),
                    option_type: SessionConfigOptionType::Select,
                    current_value: "auto".into(),
                    options: vec![
                        RawSessionConfigValue {
                            value: "read-only".into(),
                            name: "Read Only".into(),
                            description: None,
                        },
                        RawSessionConfigValue {
                            value: "auto".into(),
                            name: "Auto".into(),
                            description: None,
                        },
                    ],
                },
            ],
            None,
        );

        assert_eq!(
            controls
                .collaboration_mode
                .as_ref()
                .and_then(|control| control.current_value.as_deref()),
            Some("plan")
        );
        assert_eq!(
            controls
                .mode
                .as_ref()
                .and_then(|control| control.current_value.as_deref()),
            Some("auto")
        );
    }

    #[test]
    fn normalize_controls_keeps_fast_mode_distinct_from_mode() {
        let controls = normalize_controls(
            &[
                RawSessionConfigOption {
                    id: "fast_mode".into(),
                    name: "Fast Mode".into(),
                    description: None,
                    category: Some("fast_mode".into()),
                    option_type: SessionConfigOptionType::Select,
                    current_value: "on".into(),
                    options: vec![
                        RawSessionConfigValue {
                            value: "off".into(),
                            name: "Off".into(),
                            description: None,
                        },
                        RawSessionConfigValue {
                            value: "on".into(),
                            name: "On".into(),
                            description: None,
                        },
                    ],
                },
                RawSessionConfigOption {
                    id: "mode".into(),
                    name: "Approval Preset".into(),
                    description: None,
                    category: Some("mode".into()),
                    option_type: SessionConfigOptionType::Select,
                    current_value: "auto".into(),
                    options: vec![
                        RawSessionConfigValue {
                            value: "read-only".into(),
                            name: "Read Only".into(),
                            description: None,
                        },
                        RawSessionConfigValue {
                            value: "auto".into(),
                            name: "Auto".into(),
                            description: None,
                        },
                    ],
                },
            ],
            None,
        );

        assert_eq!(
            controls
                .fast_mode
                .as_ref()
                .and_then(|control| control.current_value.as_deref()),
            Some("on")
        );
        assert_eq!(
            controls
                .mode
                .as_ref()
                .and_then(|control| control.current_value.as_deref()),
            Some("auto")
        );
    }
}
