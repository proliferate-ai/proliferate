use super::*;
use crate::domains::agent_operations::model::{
    AgentConfigChoiceError, AgentLaunchSelectionError, RuntimeIdentity,
};
use crate::domains::agents::catalog::bundled::bundled_agent_catalog_document;
use crate::domains::agents::readiness::launch_options::ResolvedModelEffort;
use crate::domains::sessions::live_config::EffectiveLiveConfigValue;

fn effective_fixture() -> (
    ActiveCatalog,
    ResolvedWorkspaceLaunchOptions,
    String,
    String,
) {
    let catalog = ActiveCatalog::new(Arc::new(bundled_agent_catalog_document().clone()));
    let catalog_agent = catalog
        .agents()
        .iter()
        .find(|agent| agent.session.models.len() > 1)
        .expect("bundled agent with multiple models");
    let catalog_model = &catalog_agent.session.models[0];
    let agent_kind = catalog_agent.kind.clone();
    let model_id = catalog_model.id.clone();
    let resolved = ResolvedWorkspaceLaunchOptions {
        agents: vec![ResolvedLaunchAgentOption {
            kind: agent_kind.clone(),
            display_name: catalog_agent.display_name.clone(),
            default_model_id: Some(model_id.clone()),
            unattended_mode_id: catalog_agent.session.unattended_mode_id.clone(),
            models: vec![ResolvedLaunchModelOption {
                id: model_id.clone(),
                display_name: catalog_model.display_name.clone(),
                aliases: catalog_model.aliases.clone(),
                is_default: true,
                default_opt_in: None,
                description: catalog_model.description.clone(),
                provider: None,
                status: Some(catalog_model.status),
                effort: Some(ResolvedModelEffort {
                    values: vec!["high".to_string()],
                    default: Some("high".to_string()),
                }),
                live_effort_candidates: Vec::new(),
                fast_mode: false,
                modes: Some(vec!["mode-a".to_string()]),
            }],
        }],
    };
    (catalog, resolved, agent_kind, model_id)
}

#[test]
fn effective_launch_view_preserves_catalog_universe_and_validates_only_executable_rows() {
    let (catalog, resolved, agent_kind, model_id) = effective_fixture();
    let workspace = WorkspaceIdentity {
        runtime_id: RuntimeIdentity::new("runtime-1"),
        workspace_id: "workspace-target".to_string(),
    };
    let mut view = project_launch_options(workspace.clone(), &catalog, resolved);

    assert_eq!(view.workspace, workspace);
    assert_eq!(view.agents.len(), catalog.agents().len());
    let agent = view
        .agents
        .iter()
        .find(|agent| agent.agent_kind == agent_kind)
        .expect("effective agent");
    assert!(agent.executable);
    assert!(
        agent
            .models
            .iter()
            .find(|model| model.id == model_id)
            .expect("effective model")
            .executable
    );
    let unavailable_model_id = agent
        .models
        .iter()
        .find(|model| model.id != model_id)
        .expect("catalog-only unavailable model")
        .id
        .clone();
    assert!(
        !agent
            .models
            .iter()
            .find(|model| model.id == unavailable_model_id)
            .expect("unavailable model")
            .executable
    );
    assert!(view
        .validate_selection(&agent_kind, Some(&model_id), Some("mode-a"))
        .is_ok());
    assert_eq!(
        view.validate_selection(&agent_kind, Some(&unavailable_model_id), None),
        Err(AgentLaunchSelectionError::ModelUnavailable)
    );
    let unavailable_agent = view
        .agents
        .iter()
        .find(|candidate| !candidate.executable)
        .expect("catalog-only unavailable agent");
    assert_eq!(
        view.validate_selection(&unavailable_agent.agent_kind, None, None),
        Err(AgentLaunchSelectionError::AgentUnavailable)
    );

    let effective_agent = view
        .agents
        .iter_mut()
        .find(|agent| agent.agent_kind == agent_kind)
        .expect("effective agent");
    effective_agent.models[0]
        .aliases
        .push("model-alias".to_string());
    let alternate = effective_agent
        .models
        .iter_mut()
        .find(|model| model.id == unavailable_model_id)
        .expect("alternate model");
    alternate.executable = true;
    alternate.unavailable_reason = None;
    alternate.modes = Some(vec!["alternate-mode".to_string()]);
    assert_eq!(
        view.validate_selection(&agent_kind, None, Some("alternate-mode")),
        Err(AgentLaunchSelectionError::ModeUnknown)
    );
    assert!(view
        .validate_selection(
            &agent_kind,
            Some(&unavailable_model_id),
            Some("alternate-mode"),
        )
        .is_ok());
    assert_eq!(
        view.validate_selection(&agent_kind, Some("model-alias"), None)
            .expect("alias selection")
            .model_id
            .as_deref(),
        Some(model_id.as_str())
    );
}

#[test]
fn legacy_session_without_auth_contexts_keeps_every_settable_acp_model_token() {
    let (catalog, resolved, agent_kind, model_id) = effective_fixture();
    let workspace = WorkspaceIdentity {
        runtime_id: RuntimeIdentity::new("runtime-1"),
        workspace_id: "workspace-target".to_string(),
    };
    let mut launch = project_launch_options(workspace.clone(), &catalog, resolved);
    let raw_alias = "acp/live-alias-token".to_string();
    let raw_uncataloged = "provider/session-only-token".to_string();
    launch
        .agents
        .iter_mut()
        .find(|agent| agent.agent_kind == agent_kind)
        .and_then(|agent| agent.models.iter_mut().find(|model| model.id == model_id))
        .expect("launch model")
        .aliases
        .push(raw_alias.clone());
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
        agent_kind,
        Some(model_id),
        catalog.catalog_version().to_string(),
        Some(snapshot),
        &launch.agents,
        // A legacy record with no agent_auth_contexts authorizes no
        // catalog-only additions. Its live ACP vocabulary still governs.
        &HashSet::new(),
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
fn acp_alias_write_token_and_catalog_foreign_choice_are_kept_separate() {
    let (catalog, resolved, agent_kind, model_id) = effective_fixture();
    let workspace = WorkspaceIdentity {
        runtime_id: RuntimeIdentity::new("runtime-1"),
        workspace_id: "workspace-target".to_string(),
    };
    let mut launch = project_launch_options(workspace.clone(), &catalog, resolved);
    let raw_alias = "vendor/model-alias".to_string();
    launch
        .agents
        .iter_mut()
        .find(|agent| agent.agent_kind == agent_kind)
        .and_then(|agent| agent.models.iter_mut().find(|model| model.id == model_id))
        .expect("launch model")
        .aliases
        .push(raw_alias.clone());
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
        agent_kind,
        Some(raw_alias.clone()),
        catalog.catalog_version().to_string(),
        Some(snapshot),
        &launch.agents,
        &HashSet::from([model_id.clone()]),
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
    assert!(model
        .values
        .iter()
        .any(|value| value.value == model_id && value.executable));
    assert_eq!(
        view.validate_choice("model_selector", &raw_alias)
            .expect("raw ACP alias")
            .value,
        raw_alias
    );
    assert_eq!(
        view.validate_choice("model_selector", &model_id)
            .expect("catalog-authorized foreign token")
            .value,
        model_id
    );
}

#[test]
fn non_settable_acp_values_stay_visible_but_unavailable() {
    let (catalog, resolved, agent_kind, model_id) = effective_fixture();
    let workspace = WorkspaceIdentity {
        runtime_id: RuntimeIdentity::new("runtime-1"),
        workspace_id: "workspace-target".to_string(),
    };
    let launch = project_launch_options(workspace.clone(), &catalog, resolved);
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
        agent_kind,
        Some(raw_value.clone()),
        catalog.catalog_version().to_string(),
        Some(snapshot),
        &launch.agents,
        &HashSet::from([model_id.clone()]),
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
        view.validate_choice("model", &model_id)
            .expect("separate catalog choice")
            .value,
        model_id
    );
}
