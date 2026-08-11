use std::collections::HashSet;
use std::sync::Arc;

use super::{
    authorization_policy, status_from_record_only, AgentCatalogReads, AgentLaunchOptionReads,
    AgentOperations, AgentOperationsError, CallerFacts, ResolvedAgent, TargetFacts,
};
use crate::domains::agent_operations::model::{
    AgentCapability, AgentConfigOption, AgentConfigOptionsView, AgentConfigValueOption,
    AgentIdentity, AgentLaunchModelOption, AgentLaunchOption, AgentLaunchOptionsView, AgentRole,
    CapabilityDenial, WorkspaceIdentity,
};
use crate::domains::agents::catalog::schema::{AgentCatalogAgent, AgentCatalogModel};
use crate::domains::agents::catalog::service::ActiveCatalog;
use crate::domains::agents::model::ModelCatalogStatus;
use crate::domains::agents::readiness::launch_options::{
    ResolvedLaunchAgentOption, ResolvedLaunchModelOption, ResolvedWorkspaceLaunchOptions,
};
use crate::domains::sessions::live_config::{
    EffectiveLiveConfigControl, EffectiveLiveConfigSnapshot,
};
use crate::domains::workspaces::options::WorkspaceOptionsError;

impl AgentOperations {
    #[tracing::instrument(skip_all, fields(operation = "list_agent_launch_options"))]
    pub async fn list_agent_launch_options(
        &self,
        caller: &crate::domains::agent_operations::model::AuthenticatedAgentCaller,
        workspace: &WorkspaceIdentity,
    ) -> Result<AgentLaunchOptionsView, AgentOperationsError> {
        self.resolve_caller_agent(caller)?;
        self.assert_workspace_same_runtime(workspace)?;
        if self
            .workspace_operations()?
            .get_workspace(&workspace.workspace_id)
            .await?
            .is_none()
        {
            return Err(AgentOperationsError::Workspace(
                WorkspaceOptionsError::WorkspaceNotFound(workspace.workspace_id.clone()),
            ));
        }
        let resolved = self
            .launch_option_reads()?
            .resolved_workspace_launch_options(&workspace.workspace_id)
            .map_err(AgentOperationsError::Internal)?;
        let catalog = self.catalog_reads()?.active_catalog();
        Ok(project_launch_options(
            workspace.clone(),
            &catalog,
            resolved,
        ))
    }

    #[tracing::instrument(skip_all, fields(operation = "list_agent_config_options"))]
    pub async fn list_agent_config_options(
        &self,
        caller: &crate::domains::agent_operations::model::AuthenticatedAgentCaller,
        target: &AgentIdentity,
    ) -> Result<AgentConfigOptionsView, AgentOperationsError> {
        self.assert_same_runtime(target)?;
        let caller_agent = self.resolve_caller_agent(caller)?;
        let target_agent = self.resolve_agent(target)?;
        self.assert_config_target_authorized(&caller_agent, &target_agent)?;

        let workspace = WorkspaceIdentity {
            runtime_id: self.runtime_id.clone(),
            workspace_id: target_agent.record.workspace_id.clone(),
        };
        if self
            .workspace_operations()?
            .get_workspace(&workspace.workspace_id)
            .await?
            .is_none()
        {
            return Err(AgentOperationsError::Workspace(
                WorkspaceOptionsError::WorkspaceNotFound(workspace.workspace_id.clone()),
            ));
        }
        let resolved = self
            .launch_option_reads()?
            .resolved_workspace_launch_options(&workspace.workspace_id)
            .map_err(AgentOperationsError::Internal)?;
        let catalog_reads = self.catalog_reads()?;
        let catalog = catalog_reads.active_catalog();
        let snapshot = catalog_reads
            .checked_live_config_snapshot(&target_agent.record.id)
            .map_err(AgentOperationsError::Internal)?;
        let projected_launch = project_launch_options(workspace.clone(), &catalog, resolved);
        let switchable_model_ids = projected_launch
            .agents
            .iter()
            .find(|agent| agent.agent_kind == target_agent.record.agent_kind)
            .into_iter()
            .flat_map(|agent| agent.models.iter())
            .filter(|model| {
                model.executable
                    && catalog_reads.live_model_switch_authorized(&target_agent.record, &model.id)
            })
            .map(|model| model.id.clone())
            .collect::<HashSet<_>>();
        Ok(project_config_options(
            AgentIdentity::new(self.runtime_id.clone(), target_agent.record.id),
            workspace,
            target_agent.record.agent_kind,
            target_agent
                .record
                .current_model_id
                .or(target_agent.record.requested_model_id),
            catalog.catalog_version().to_string(),
            snapshot,
            &projected_launch.agents,
            &switchable_model_ids,
        ))
    }

    fn launch_option_reads(
        &self,
    ) -> Result<&Arc<dyn AgentLaunchOptionReads>, AgentOperationsError> {
        self.launch_options
            .as_ref()
            .ok_or(AgentOperationsError::WorkspaceCatalogsUnavailable)
    }

    fn catalog_reads(&self) -> Result<&Arc<dyn AgentCatalogReads>, AgentOperationsError> {
        self.catalog
            .as_ref()
            .ok_or(AgentOperationsError::WorkspaceCatalogsUnavailable)
    }

    fn assert_workspace_same_runtime(
        &self,
        workspace: &WorkspaceIdentity,
    ) -> Result<(), AgentOperationsError> {
        if workspace.runtime_id != self.runtime_id {
            return Err(AgentOperationsError::RuntimeBoundaryDenied);
        }
        Ok(())
    }

    fn assert_config_target_authorized(
        &self,
        caller: &ResolvedAgent,
        target: &ResolvedAgent,
    ) -> Result<(), AgentOperationsError> {
        let owned_by_caller = target.parent_session_id() == Some(caller.record.id.as_str());
        if target.role() == AgentRole::Subagent && !owned_by_caller {
            return Err(AgentOperationsError::AgentNotFound);
        }
        if target.role() == AgentRole::Subagent && target.is_relationship_closed() {
            return Err(AgentOperationsError::SubagentOpenRequired);
        }
        if target.is_terminal_session() {
            return Err(AgentOperationsError::AgentNotFound);
        }

        let decision = authorization_policy::target_capability(
            CallerFacts {
                role: caller.role(),
                status: status_from_record_only(caller).presentation,
            },
            TargetFacts {
                role: target.role(),
                status: status_from_record_only(target).presentation,
                owned_by_caller,
            },
            AgentCapability::ListAgentConfigOptions,
        );
        match decision.denial {
            None => Ok(()),
            Some(CapabilityDenial::SubagentOpenRequired) => {
                Err(AgentOperationsError::SubagentOpenRequired)
            }
            Some(CapabilityDenial::ParentOnly) => Err(AgentOperationsError::AgentNotFound),
            Some(CapabilityDenial::CallerClosed) => Err(AgentOperationsError::CallerClosed),
            Some(denial) => Err(AgentOperationsError::CapabilityDenied {
                capability: AgentCapability::ListAgentConfigOptions,
                denial,
            }),
        }
    }
}

fn project_launch_options(
    workspace: WorkspaceIdentity,
    catalog: &ActiveCatalog,
    resolved: ResolvedWorkspaceLaunchOptions,
) -> AgentLaunchOptionsView {
    let mut remaining = resolved.agents;
    let mut agents = Vec::with_capacity(catalog.agents().len());
    for catalog_agent in catalog.agents() {
        let resolved = remaining
            .iter()
            .position(|candidate| candidate.kind == catalog_agent.kind)
            .map(|index| remaining.remove(index));
        agents.push(project_launch_agent(catalog_agent, resolved));
    }
    agents.extend(remaining.into_iter().map(project_uncataloged_launch_agent));
    AgentLaunchOptionsView {
        workspace,
        catalog_version: catalog.catalog_version().to_string(),
        agents,
    }
}

fn project_launch_agent(
    catalog_agent: &AgentCatalogAgent,
    resolved: Option<ResolvedLaunchAgentOption>,
) -> AgentLaunchOption {
    let executable = resolved.is_some();
    let mut resolved_models = resolved
        .as_ref()
        .map(|agent| agent.models.clone())
        .unwrap_or_default();
    let mut models = Vec::with_capacity(catalog_agent.session.models.len());
    for catalog_model in &catalog_agent.session.models {
        let resolved_model = resolved_models
            .iter()
            .position(|candidate| candidate.id == catalog_model.id)
            .map(|index| resolved_models.remove(index));
        models.push(project_launch_model(
            catalog_model,
            resolved_model,
            executable,
        ));
    }
    models.extend(
        resolved_models
            .into_iter()
            .map(project_uncataloged_launch_model),
    );
    AgentLaunchOption {
        agent_kind: catalog_agent.kind.clone(),
        display_name: catalog_agent.display_name.clone(),
        executable,
        unavailable_reason: (!executable)
            .then(|| "This agent is not currently launchable in the workspace.".to_string()),
        default_model_id: resolved
            .as_ref()
            .and_then(|agent| agent.default_model_id.clone()),
        unattended_mode_id: catalog_agent.session.unattended_mode_id.clone(),
        models,
    }
}

fn project_launch_model(
    catalog_model: &AgentCatalogModel,
    resolved: Option<ResolvedLaunchModelOption>,
    agent_executable: bool,
) -> AgentLaunchModelOption {
    let executable = agent_executable && resolved.is_some();
    AgentLaunchModelOption {
        id: catalog_model.id.clone(),
        display_name: catalog_model.display_name.clone(),
        aliases: resolved
            .as_ref()
            .map(|model| model.aliases.clone())
            .unwrap_or_else(|| catalog_model.aliases.clone()),
        is_default: resolved.as_ref().is_some_and(|model| model.is_default),
        executable,
        unavailable_reason: (!executable)
            .then(|| "This model is not currently available for the workspace.".to_string()),
        description: resolved
            .as_ref()
            .and_then(|model| model.description.clone())
            .or_else(|| catalog_model.description.clone()),
        status: resolved
            .as_ref()
            .and_then(|model| model.status)
            .unwrap_or(catalog_model.status),
        effort_values: resolved
            .as_ref()
            .and_then(|model| model.effort.as_ref())
            .map(|effort| effort.values.clone()),
        fast_mode: resolved.as_ref().is_some_and(|model| model.fast_mode),
        modes: resolved.as_ref().and_then(|model| model.modes.clone()),
    }
}

fn project_uncataloged_launch_agent(resolved: ResolvedLaunchAgentOption) -> AgentLaunchOption {
    AgentLaunchOption {
        agent_kind: resolved.kind,
        display_name: resolved.display_name,
        executable: true,
        unavailable_reason: None,
        default_model_id: resolved.default_model_id,
        unattended_mode_id: resolved.unattended_mode_id,
        models: resolved
            .models
            .into_iter()
            .map(project_uncataloged_launch_model)
            .collect(),
    }
}

fn project_uncataloged_launch_model(model: ResolvedLaunchModelOption) -> AgentLaunchModelOption {
    AgentLaunchModelOption {
        id: model.id,
        display_name: model.display_name,
        aliases: model.aliases,
        is_default: model.is_default,
        executable: true,
        unavailable_reason: None,
        description: model.description,
        status: model.status.unwrap_or(ModelCatalogStatus::Active),
        effort_values: model.effort.map(|effort| effort.values),
        fast_mode: model.fast_mode,
        modes: model.modes,
    }
}

fn project_config_options(
    agent: AgentIdentity,
    workspace: WorkspaceIdentity,
    agent_kind: String,
    current_model_id: Option<String>,
    catalog_version: String,
    snapshot: Option<EffectiveLiveConfigSnapshot>,
    launch_agents: &[AgentLaunchOption],
    switchable_model_ids: &HashSet<String>,
) -> AgentConfigOptionsView {
    let live_snapshot_available = snapshot.is_some();
    let launch_models = launch_agents
        .iter()
        .find(|candidate| candidate.agent_kind == agent_kind)
        .map(|candidate| candidate.models.as_slice())
        .unwrap_or(&[]);
    let mut options = snapshot
        .map(|snapshot| snapshot.controls)
        .unwrap_or_default()
        .into_iter()
        .map(|control| project_config_control(control, launch_models, switchable_model_ids))
        .collect::<Vec<_>>();
    if !options.iter().any(|option| option.key == "model") && !launch_models.is_empty() {
        options.insert(
            0,
            synthetic_model_control(current_model_id, launch_models, switchable_model_ids),
        );
    }
    AgentConfigOptionsView {
        agent,
        workspace,
        catalog_version,
        live_snapshot_available,
        options,
    }
}

fn project_config_control(
    control: EffectiveLiveConfigControl,
    launch_models: &[AgentLaunchModelOption],
    switchable_model_ids: &HashSet<String>,
) -> AgentConfigOption {
    let is_model = control.key == "model";
    let mut values = if is_model {
        control
            .values
            .into_iter()
            .filter_map(|value| {
                let model =
                    switchable_launch_model(&value.value, launch_models, switchable_model_ids)?;
                Some(AgentConfigValueOption {
                    value: model.id.clone(),
                    label: value.label,
                    description: value.description.or_else(|| model.description.clone()),
                    executable: model.executable,
                    unavailable_reason: model.unavailable_reason.clone(),
                })
            })
            .collect::<Vec<_>>()
    } else {
        control
            .values
            .into_iter()
            .map(|value| AgentConfigValueOption {
                value: value.value,
                label: value.label,
                description: value.description,
                executable: control.settable,
                unavailable_reason: (!control.settable).then(|| {
                    "This live control does not currently offer another value.".to_string()
                }),
            })
            .collect::<Vec<_>>()
    };
    if is_model {
        for model in launch_models
            .iter()
            .filter(|model| switchable_model_ids.contains(&model.id))
        {
            if let Some(existing) = values
                .iter_mut()
                .find(|value| value.value == model.id || model.aliases.contains(&value.value))
            {
                existing.executable |= model.executable;
                if existing.executable {
                    existing.unavailable_reason = None;
                }
            } else {
                values.push(config_value_from_launch_model(model));
            }
        }
    }
    let executable = if is_model {
        values.iter().any(|value| value.executable)
    } else {
        control.settable
    };
    AgentConfigOption {
        key: control.key,
        config_id: control.config_id,
        label: control.label,
        current_value: control.current_value,
        executable,
        unavailable_reason: (!executable)
            .then(|| "This live control is not currently settable.".to_string()),
        values,
    }
}

fn switchable_launch_model<'a>(
    value: &str,
    launch_models: &'a [AgentLaunchModelOption],
    switchable_model_ids: &HashSet<String>,
) -> Option<&'a AgentLaunchModelOption> {
    launch_models.iter().find(|model| {
        switchable_model_ids.contains(&model.id)
            && (model.id == value || model.aliases.iter().any(|alias| alias == value))
    })
}

fn synthetic_model_control(
    current_model_id: Option<String>,
    launch_models: &[AgentLaunchModelOption],
    switchable_model_ids: &HashSet<String>,
) -> AgentConfigOption {
    let values = launch_models
        .iter()
        .filter(|model| switchable_model_ids.contains(&model.id))
        .map(config_value_from_launch_model)
        .collect::<Vec<_>>();
    let executable = values.iter().any(|value| value.executable);
    AgentConfigOption {
        key: "model".to_string(),
        config_id: crate::domains::sessions::live_config::ACP_MODEL_COMPAT_CONFIG_ID.to_string(),
        label: "Model".to_string(),
        current_value: current_model_id,
        executable,
        unavailable_reason: (!executable)
            .then(|| "No model is currently switchable for this workspace.".to_string()),
        values,
    }
}

fn config_value_from_launch_model(model: &AgentLaunchModelOption) -> AgentConfigValueOption {
    AgentConfigValueOption {
        value: model.id.clone(),
        label: model.display_name.clone(),
        description: model.description.clone(),
        executable: model.executable,
        unavailable_reason: model.unavailable_reason.clone(),
    }
}

#[cfg(test)]
mod tests {
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
    fn config_view_uses_target_workspace_catalog_and_reuses_exact_choice_validator() {
        let (catalog, resolved, agent_kind, model_id) = effective_fixture();
        let workspace = WorkspaceIdentity {
            runtime_id: RuntimeIdentity::new("runtime-1"),
            workspace_id: "workspace-target".to_string(),
        };
        let launch = project_launch_options(workspace.clone(), &catalog, resolved);
        let unauthorized_model_id = launch
            .agents
            .iter()
            .find(|agent| !agent.models.is_empty())
            .and_then(|agent| agent.models.iter().find(|model| model.id != model_id))
            .expect("catalog-only model")
            .id
            .clone();
        let snapshot = EffectiveLiveConfigSnapshot {
            controls: vec![
                EffectiveLiveConfigControl {
                    key: "model".to_string(),
                    config_id: "model".to_string(),
                    label: "Model".to_string(),
                    current_value: Some(model_id.clone()),
                    settable: false,
                    values: vec![
                        EffectiveLiveConfigValue {
                            value: model_id.clone(),
                            label: model_id.clone(),
                            description: None,
                        },
                        EffectiveLiveConfigValue {
                            value: unauthorized_model_id.clone(),
                            label: "Unauthorized model".to_string(),
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
            Some(model_id.clone()),
            catalog.catalog_version().to_string(),
            Some(snapshot),
            &launch.agents,
            &HashSet::from([model_id.clone()]),
        );

        assert_eq!(view.workspace, workspace);
        assert!(view.validate_choice("model", &model_id).is_ok());
        assert!(view.validate_choice("effort", "high").is_ok());
        assert!(view
            .options
            .iter()
            .find(|option| option.config_id == "model")
            .is_some_and(|option| option
                .values
                .iter()
                .all(|value| value.value != unauthorized_model_id)));
        assert_eq!(
            view.validate_choice("model", &unauthorized_model_id),
            Err(AgentConfigChoiceError::ValueUnknown)
        );
    }
}
