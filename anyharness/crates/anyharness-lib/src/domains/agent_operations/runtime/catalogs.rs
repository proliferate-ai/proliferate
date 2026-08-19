use std::sync::Arc;

use super::{
    AgentCatalogReads, AgentLaunchOptionReads, AgentOperations, AgentOperationsError, ResolvedAgent,
};
use crate::domains::agent_operations::model::{
    AgentCapability, AgentConfigOption, AgentConfigOptionsView, AgentConfigValueOption,
    AgentIdentity, AgentLaunchOptionsView, HarnessLaunchModelPresentation,
    HarnessLaunchPresentation, WorkspaceIdentity,
};
use crate::domains::agents::catalog::service::ActiveCatalog;
use crate::domains::agents::launch_options::HarnessLaunchOptionsResponse;
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
            .harness_launch_options()
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
    launch_options: Vec<HarnessLaunchOptionsResponse>,
) -> AgentLaunchOptionsView {
    let presentation = launch_options
        .iter()
        .map(|response| {
            let catalog_agent = catalog.agent(&response.harness_kind);
            let models = response
                .options
                .as_ref()
                .map(|options| {
                    options
                        .models
                        .iter()
                        .map(|model| {
                            let catalog_model = catalog_agent.and_then(|agent| {
                                agent
                                    .session
                                    .presentation_models
                                    .iter()
                                    .find(|candidate| candidate.id == model.id)
                            });
                            HarnessLaunchModelPresentation {
                                id: model.id.clone(),
                                display_name: model
                                    .observed_name
                                    .clone()
                                    .or_else(|| {
                                        catalog_model.map(|value| value.display_name.clone())
                                    })
                                    .unwrap_or_else(|| model.id.clone()),
                                description: model.observed_description.clone().or_else(|| {
                                    catalog_model.and_then(|value| value.description.clone())
                                }),
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();
            HarnessLaunchPresentation {
                harness_kind: response.harness_kind.clone(),
                display_name: catalog_agent
                    .map(|agent| agent.display_name.clone())
                    .unwrap_or_else(|| response.harness_kind.clone()),
                models,
            }
        })
        .collect();
    AgentLaunchOptionsView {
        workspace,
        launch_options,
        presentation,
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

fn project_config_control(control: EffectiveLiveConfigControl) -> AgentConfigOption {
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
