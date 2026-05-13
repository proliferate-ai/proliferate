use std::path::PathBuf;

use crate::domains::agents::registry::built_in_registry;

use super::model::{DynamicModelRegistrySnapshot, RefreshModelRegistryOptions};
use super::projection::effective_registry_for_kind;
use super::refresh::refresh_snapshot_for_descriptor;
use super::store::DynamicModelRegistryStore;
use crate::domains::agents::model::ModelRegistryMetadata;
use crate::domains::agents::readiness::launch_options::{
    workspace_session_launch_options_with_dynamic_registry, ResolvedWorkspaceLaunchOptions,
};

#[derive(Clone)]
pub struct DynamicModelRegistryService {
    store: DynamicModelRegistryStore,
    runtime_home: PathBuf,
}

impl DynamicModelRegistryService {
    pub fn new(store: DynamicModelRegistryStore, runtime_home: PathBuf) -> Self {
        Self {
            store,
            runtime_home,
        }
    }

    pub fn snapshot(
        &self,
        agent_kind: &str,
        workspace_id: Option<&str>,
    ) -> anyhow::Result<Option<DynamicModelRegistrySnapshot>> {
        self.store.get(agent_kind, workspace_id)
    }

    pub fn effective_registry(
        &self,
        agent_kind: &str,
        workspace_id: Option<&str>,
    ) -> anyhow::Result<Option<ModelRegistryMetadata>> {
        let snapshot = self.snapshot(agent_kind, workspace_id)?;
        Ok(effective_registry_for_kind(agent_kind, snapshot.as_ref()))
    }

    pub fn refresh(
        &self,
        agent_kind: &str,
        options: RefreshModelRegistryOptions,
    ) -> anyhow::Result<DynamicModelRegistrySnapshot> {
        let descriptor = built_in_registry()
            .into_iter()
            .find(|descriptor| descriptor.kind.as_str() == agent_kind)
            .ok_or_else(|| anyhow::anyhow!("agent not found: {agent_kind}"))?;
        let previous_models = self
            .store
            .get(agent_kind, options.workspace_id.as_deref())?
            .map(|snapshot| snapshot.models)
            .unwrap_or_default();
        let snapshot = refresh_snapshot_for_descriptor(
            &descriptor,
            &self.runtime_home,
            options.workspace_id,
            options.force_provider_refresh,
            previous_models,
        );
        self.store.upsert(&snapshot)?;
        Ok(snapshot)
    }

    pub fn workspace_launch_options(
        &self,
        workspace_id: Option<&str>,
    ) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> {
        workspace_session_launch_options_with_dynamic_registry(
            &self.runtime_home,
            &self.store,
            workspace_id,
        )
    }
}
