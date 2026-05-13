use std::path::Path;

use crate::domains::agents::catalog::projection::models::{
    bundled_catalog_version, bundled_model_registries,
};
use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agents::registry::built_in_registry;
use crate::domains::agents::resolver::resolve_agent;

#[derive(Debug, Clone)]
pub struct WorkspaceSessionLaunchModelData {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone)]
pub struct WorkspaceSessionLaunchAgentData {
    pub kind: String,
    pub display_name: String,
    pub default_model_id: Option<String>,
    pub models: Vec<WorkspaceSessionLaunchModelData>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceSessionLaunchCatalogData {
    pub workspace_id: String,
    pub catalog_version: String,
    pub agents: Vec<WorkspaceSessionLaunchAgentData>,
}

pub fn workspace_session_launch_options(
    workspace_id: &str,
    runtime_home: &Path,
) -> WorkspaceSessionLaunchCatalogData {
    let registry = built_in_registry();
    let agents = bundled_model_registries()
        .into_iter()
        .filter_map(|model_registry| {
            let descriptor = registry
                .iter()
                .find(|descriptor| descriptor.kind.as_str() == model_registry.kind)?;
            let resolved = resolve_agent(descriptor, runtime_home);
            if resolved.status != ResolvedAgentStatus::Ready {
                return None;
            }

            Some(WorkspaceSessionLaunchAgentData {
                kind: model_registry.kind,
                display_name: model_registry.display_name,
                default_model_id: model_registry.default_model_id,
                models: model_registry
                    .models
                    .into_iter()
                    .map(|model| WorkspaceSessionLaunchModelData {
                        id: model.id,
                        display_name: model.display_name,
                        is_default: model.is_default,
                    })
                    .collect(),
            })
        })
        .collect();

    WorkspaceSessionLaunchCatalogData {
        workspace_id: workspace_id.to_string(),
        catalog_version: bundled_catalog_version(),
        agents,
    }
}
