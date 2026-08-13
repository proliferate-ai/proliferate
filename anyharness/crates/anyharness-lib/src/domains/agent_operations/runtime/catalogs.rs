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
    // The live actor is authoritative for every token it advertised. Keep
    // those values byte-for-byte and judge them only by the control's own
    // settable state; catalog identity/auth must not erase or canonicalize a
    // token that the same ACP setter accepts.
    let mut values = control
        .values
        .into_iter()
        .map(|value| AgentConfigValueOption {
            value: value.value,
            label: value.label,
            description: value.description,
            executable: control.settable,
            unavailable_reason: (!control.settable)
                .then(|| "This live control does not currently offer another value.".to_string()),
        })
        .collect::<Vec<_>>();
    if is_model {
        // Catalog authorization is a second, additive path for a model the
        // live control did not advertise under this exact write token. Do not
        // merge an ACP alias into the catalog's canonical id: both tokens have
        // different mutation semantics and the validator must return the one
        // the caller selected.
        for model in launch_models
            .iter()
            .filter(|model| switchable_model_ids.contains(&model.id))
        {
            if !values.iter().any(|value| value.value == model.id) {
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
#[path = "catalogs/tests.rs"]
mod tests;
