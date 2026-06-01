use agent_client_protocol as acp;
use anyharness_contract::v1::{
    PromptCapabilities, RawSessionConfigOption, RawSessionConfigValue, SessionConfigOptionType,
};

use super::controls::normalize_controls;
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
        PromptCapabilities::default(),
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
