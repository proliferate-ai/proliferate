use std::sync::Arc;

use super::{
    AgentCatalogReads, AgentLaunchOptionReads, AgentOperations, AgentOperationsError, ResolvedAgent,
};
use crate::domains::agent_operations::model::{
    AgentCapability, AgentConfigOption, AgentConfigOptionsView, AgentConfigValueOption,
    AgentIdentity, AgentLaunchModelOption, AgentLaunchOption, AgentLaunchOptionsView,
    WorkspaceIdentity,
};
use crate::domains::agents::catalog::schema::{
    AgentCatalogAgent, AgentCatalogPresentationModel,
};
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
        let (_, target_agent) =
            self.authorize_target(caller, target, AgentCapability::ListAgentConfigOptions)?;
        self.config_options_for_authorized_target(&target_agent)
            .await
    }

    pub(super) async fn config_options_for_authorized_target(
        &self,
        target_agent: &ResolvedAgent,
    ) -> Result<AgentConfigOptionsView, AgentOperationsError> {
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
        let catalog_reads = self.catalog_reads()?;
        let catalog = catalog_reads.active_catalog();
        let snapshot = catalog_reads
            .checked_live_config_snapshot(&target_agent.record.id)
            .map_err(AgentOperationsError::Internal)?;
        Ok(project_config_options(
            AgentIdentity::new(self.runtime_id.clone(), target_agent.record.id.clone()),
            workspace,
            catalog.catalog_version().to_string(),
            snapshot,
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

    pub(super) fn assert_workspace_same_runtime(
        &self,
        workspace: &WorkspaceIdentity,
    ) -> Result<(), AgentOperationsError> {
        if workspace.runtime_id != self.runtime_id {
            return Err(AgentOperationsError::RuntimeBoundaryDenied);
        }
        Ok(())
    }
}

fn project_launch_options(
    workspace: WorkspaceIdentity,
    catalog: &ActiveCatalog,
    resolved: ResolvedWorkspaceLaunchOptions,
) -> AgentLaunchOptionsView {
    let agents = resolved
        .agents
        .into_iter()
        .map(|agent| {
            let presentation = catalog.agent(&agent.kind);
            project_launch_agent(agent, presentation)
        })
        .collect();
    AgentLaunchOptionsView {
        workspace,
        catalog_version: catalog.catalog_version().to_string(),
        agents,
    }
}

fn project_launch_agent(
    resolved: ResolvedLaunchAgentOption,
    presentation: Option<&AgentCatalogAgent>,
) -> AgentLaunchOption {
    let display_name = presentation
        .map(|agent| agent.display_name.clone())
        .unwrap_or_else(|| resolved.display_name.clone());
    let default_model_id = resolved.default_model_id.clone();
    let controls = resolved.controls.clone();
    let default_control_values = resolved.default_control_values.clone();
    let models = resolved
        .models
        .into_iter()
        .map(|model| {
            let model_presentation = presentation.and_then(|agent| {
                agent
                    .session
                    .presentation_models
                    .iter()
                    .find(|candidate| candidate.id == model.id)
            });
            project_launch_model(model, model_presentation)
        })
        .collect();
    AgentLaunchOption {
        agent_kind: resolved.kind,
        display_name,
        executable: true,
        unavailable_reason: None,
        default_model_id,
        controls,
        default_control_values,
        models,
    }
}

fn project_launch_model(
    model: ResolvedLaunchModelOption,
    presentation: Option<&AgentCatalogPresentationModel>,
) -> AgentLaunchModelOption {
    AgentLaunchModelOption {
        id: model.id,
        display_name: presentation
            .map(|value| value.display_name.clone())
            .unwrap_or(model.display_name),
        aliases: model.aliases,
        is_default: model.is_default,
        executable: true,
        unavailable_reason: None,
        description: model
            .description
            .or_else(|| presentation.and_then(|value| value.description.clone())),
        status: model.status.unwrap_or(ModelCatalogStatus::Active),
        effort_values: model.effort.map(|effort| effort.values),
        fast_mode: model.fast_mode,
        modes: model.modes,
    }
}

fn project_config_options(
    agent: AgentIdentity,
    workspace: WorkspaceIdentity,
    catalog_version: String,
    snapshot: Option<EffectiveLiveConfigSnapshot>,
) -> AgentConfigOptionsView {
    let live_snapshot_available = snapshot.is_some();
    let options = snapshot
        .map(|snapshot| snapshot.controls)
        .unwrap_or_default()
        .into_iter()
        .map(project_config_control)
        .collect::<Vec<_>>();
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
) -> AgentConfigOption {
    // The live actor is authoritative for every token it advertised. Keep
    // those values byte-for-byte and judge them only by the control's own
    // settable state; catalog identity/auth must not erase or canonicalize a
    // token that the same ACP setter accepts.
    let values = control
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
    let executable = control.settable;
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

#[cfg(test)]
#[path = "catalogs/tests.rs"]
mod tests;
