use super::*;
use crate::domains::agent_operations::model::{
    AgentConfigChoiceError, AgentLaunchSelectionError, RuntimeIdentity,
};
use crate::domains::agents::catalog::bundled::bundled_agent_catalog_document;
use crate::domains::agents::launch_options::{
    HarnessLaunchControl, HarnessLaunchControlValue, HarnessLaunchDefaults, HarnessLaunchModel,
    HarnessLaunchOptions, HarnessLaunchOptionsResponse, HarnessLaunchOptionsState,
};
use crate::domains::sessions::live_config::EffectiveLiveConfigValue;

fn effective_fixture() -> (
    ActiveCatalog,
    Vec<HarnessLaunchOptionsResponse>,
    String,
    String,
) {
    let catalog = ActiveCatalog::new(Arc::new(bundled_agent_catalog_document().clone()));
    let catalog_agent = catalog
        .agents()
        .iter()
        .find(|agent| agent.session.presentation_models.len() > 1)
        .expect("bundled agent with presentation metadata");
    let catalog_model = &catalog_agent.session.presentation_models[0];
    let agent_kind = catalog_agent.kind.clone();
    let model_id = catalog_model.id.clone();
    let launch_options = vec![HarnessLaunchOptionsResponse {
        harness_kind: agent_kind.clone(),
        basis_revision: "basis-1".to_string(),
        revision: 1,
        state: HarnessLaunchOptionsState::Observed,
        options: Some(HarnessLaunchOptions {
            controls: vec![HarnessLaunchControl {
                id: "mode".to_string(),
                observed_label: Some("Mode".to_string()),
                observed_description: None,
                values: vec![HarnessLaunchControlValue {
                    value: "mode-a".to_string(),
                    observed_label: Some("Mode A".to_string()),
                    observed_description: None,
                }],
            }],
            defaults: HarnessLaunchDefaults {
                model_id: Some(model_id.clone()),
                control_values: Default::default(),
            },
            models: vec![HarnessLaunchModel {
                id: model_id.clone(),
                observed_name: None,
                observed_description: None,
            }],
        }),
        observed_at: Some("2026-08-19T00:00:00Z".to_string()),
        probe_attempted_at: "2026-08-19T00:00:00Z".to_string(),
        probe_failure_code: None,
    }];
    (catalog, launch_options, agent_kind, model_id)
}

#[test]
fn launch_view_contains_only_observed_membership_with_exact_presentation_join() {
    let (catalog, launch_options, agent_kind, model_id) = effective_fixture();
    let workspace = WorkspaceIdentity {
        runtime_id: RuntimeIdentity::new("runtime-1"),
        workspace_id: "workspace-target".to_string(),
    };
    let view = project_launch_options(workspace.clone(), &catalog, launch_options);

    assert_eq!(view.workspace, workspace);
    assert_eq!(view.launch_options.len(), 1);
    let response = view
        .launch_options
        .iter()
        .find(|response| response.harness_kind == agent_kind)
        .expect("observed harness");
    assert_eq!(
        response
            .options
            .as_ref()
            .expect("observed options")
            .models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        vec![model_id.as_str()]
    );
    let presentation = view
        .presentation
        .iter()
        .find(|entry| entry.harness_kind == agent_kind)
        .expect("exact-key presentation");
    assert_eq!(presentation.models.len(), 1);
    assert_eq!(presentation.models[0].id, model_id);
    assert!(view
        .validate_selection(
            &agent_kind,
            Some(&model_id),
            &[("mode".to_string(), "mode-a".to_string())].into(),
        )
        .is_ok());
    assert_eq!(
        view.validate_selection(&agent_kind, Some("presentation-only"), &Default::default()),
        Err(AgentLaunchSelectionError::ModelUnknown)
    );
}

#[test]
fn legacy_session_without_auth_contexts_keeps_every_settable_acp_model_token() {
    let (catalog, _, _, _) = effective_fixture();
    let workspace = WorkspaceIdentity {
        runtime_id: RuntimeIdentity::new("runtime-1"),
        workspace_id: "workspace-target".to_string(),
    };
    let raw_alias = "acp/live-alias-token".to_string();
    let raw_uncataloged = "provider/session-only-token".to_string();
    let snapshot = EffectiveLiveConfigSnapshot {
        controls: vec![
            EffectiveLiveConfigControl {
                key: "model".to_string(),
                config_id: "acp_model_selector".to_string(),
                label: "Model".to_string(),
                current_value: Some(raw_alias.clone()),
                settable: true,
                values: vec![
                    EffectiveLiveConfigValue {
                        value: raw_alias.clone(),
                        label: "Live alias".to_string(),
                        description: None,
                    },
                    EffectiveLiveConfigValue {
                        value: raw_uncataloged.clone(),
                        label: "Session-only model".to_string(),
                        description: None,
                    },
                ],
            },
            EffectiveLiveConfigControl {
                key: "effort".to_string(),
                config_id: "effort".to_string(),
                label: "Effort".to_string(),
                current_value: Some("medium".to_string()),
                settable: true,
                values: vec![EffectiveLiveConfigValue {
                    value: "high".to_string(),
                    label: "High".to_string(),
                    description: None,
                }],
            },
        ],
    };
    let view = project_config_options(
        AgentIdentity::new(RuntimeIdentity::new("runtime-1"), "target-agent"),
        workspace.clone(),
        catalog.catalog_version().to_string(),
        Some(snapshot),
    );

    assert_eq!(view.workspace, workspace);
    let model = view
        .options
        .iter()
        .find(|option| option.config_id == "acp_model_selector")
        .expect("model control");
    assert_eq!(
        model
            .values
            .iter()
            .map(|value| value.value.as_str())
            .collect::<Vec<_>>(),
        vec![raw_alias.as_str(), raw_uncataloged.as_str()]
    );
    assert!(model.values.iter().all(|value| value.executable));
    assert_eq!(
        view.validate_choice("acp_model_selector", &raw_alias)
            .expect("raw alias remains executable")
            .value,
        raw_alias
    );
    assert_eq!(
        view.validate_choice("acp_model_selector", &raw_uncataloged)
            .expect("uncataloged ACP token remains executable")
            .value,
        raw_uncataloged
    );
    assert!(view.validate_choice("effort", "high").is_ok());
}

#[test]
fn live_snapshot_does_not_gain_target_launch_models() {
    let (catalog, _, _, model_id) = effective_fixture();
    let workspace = WorkspaceIdentity {
        runtime_id: RuntimeIdentity::new("runtime-1"),
        workspace_id: "workspace-target".to_string(),
    };
    let raw_alias = "vendor/model-alias".to_string();
    let snapshot = EffectiveLiveConfigSnapshot {
        controls: vec![EffectiveLiveConfigControl {
            key: "model".to_string(),
            config_id: "model_selector".to_string(),
            label: "Model".to_string(),
            current_value: Some(raw_alias.clone()),
            settable: true,
            values: vec![
                EffectiveLiveConfigValue {
                    value: raw_alias.clone(),
                    label: "Vendor alias".to_string(),
                    description: None,
                },
                EffectiveLiveConfigValue {
                    value: "vendor/other-live-token".to_string(),
                    label: "Other live model".to_string(),
                    description: None,
                },
            ],
        }],
    };
    let view = project_config_options(
        AgentIdentity::new(RuntimeIdentity::new("runtime-1"), "target-agent"),
        workspace,
        catalog.catalog_version().to_string(),
        Some(snapshot),
    );
    let model = view
        .options
        .iter()
        .find(|option| option.config_id == "model_selector")
        .expect("model control");
    assert!(model
        .values
        .iter()
        .any(|value| value.value == raw_alias && value.executable));
    assert!(!model.values.iter().any(|value| value.value == model_id));
    assert_eq!(
        view.validate_choice("model_selector", &raw_alias)
            .expect("raw ACP alias")
            .value,
        raw_alias
    );
    assert_eq!(
        view.validate_choice("model_selector", &model_id),
        Err(AgentConfigChoiceError::ValueUnknown)
    );
}

#[test]
fn non_settable_acp_values_stay_visible_but_unavailable() {
    let (catalog, _, _, model_id) = effective_fixture();
    let workspace = WorkspaceIdentity {
        runtime_id: RuntimeIdentity::new("runtime-1"),
        workspace_id: "workspace-target".to_string(),
    };
    let raw_value = "live/current-only".to_string();
    let snapshot = EffectiveLiveConfigSnapshot {
        controls: vec![EffectiveLiveConfigControl {
            key: "model".to_string(),
            config_id: "model".to_string(),
            label: "Model".to_string(),
            current_value: Some(raw_value.clone()),
            settable: false,
            values: vec![EffectiveLiveConfigValue {
                value: raw_value.clone(),
                label: "Current live model".to_string(),
                description: None,
            }],
        }],
    };
    let view = project_config_options(
        AgentIdentity::new(RuntimeIdentity::new("runtime-1"), "target-agent"),
        workspace,
        catalog.catalog_version().to_string(),
        Some(snapshot),
    );

    let model = view.options.first().expect("model control");
    assert!(model
        .values
        .iter()
        .any(|value| value.value == raw_value && !value.executable));
    assert_eq!(
        view.validate_choice("model", &raw_value),
        Err(AgentConfigChoiceError::ValueUnavailable)
    );
    assert_eq!(
        view.validate_choice("model", &model_id),
        Err(AgentConfigChoiceError::ValueUnknown)
    );
}
