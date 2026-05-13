use std::path::Path;

use crate::domains::agents::catalog::projection::models::bundled_model_registries;
use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agents::registry::built_in_registry;
use crate::domains::agents::resolver::resolve_agent;

#[derive(Debug, Clone)]
pub struct ResolvedLaunchModelOption {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone)]
pub struct ResolvedLaunchAgentOption {
    pub kind: String,
    pub display_name: String,
    pub default_model_id: Option<String>,
    pub models: Vec<ResolvedLaunchModelOption>,
}

#[derive(Debug, Clone)]
pub struct ResolvedWorkspaceLaunchOptions {
    pub agents: Vec<ResolvedLaunchAgentOption>,
}

pub fn workspace_session_launch_options(runtime_home: &Path) -> ResolvedWorkspaceLaunchOptions {
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

            Some(ResolvedLaunchAgentOption {
                kind: model_registry.kind,
                display_name: model_registry.display_name,
                default_model_id: model_registry.default_model_id,
                models: model_registry
                    .models
                    .into_iter()
                    .map(|model| ResolvedLaunchModelOption {
                        id: model.id,
                        display_name: model.display_name,
                        is_default: model.is_default,
                    })
                    .collect(),
            })
        })
        .collect();

    ResolvedWorkspaceLaunchOptions { agents }
}
