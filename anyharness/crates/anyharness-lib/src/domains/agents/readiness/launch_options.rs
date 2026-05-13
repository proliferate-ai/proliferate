use std::path::Path;

use crate::domains::agents::catalog::projection::models::bundled_model_registries;
use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agents::model_registry::projection::effective_registry_for_kind;
use crate::domains::agents::model_registry::store::DynamicModelRegistryStore;
use crate::domains::agents::readiness::resolver::resolve_agent;
use crate::domains::agents::registry::built_in_registry;

#[derive(Debug, Clone)]
pub struct ResolvedLaunchModelOption {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
    pub default_opt_in: Option<bool>,
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
    workspace_session_launch_options_with_snapshots(runtime_home, None, None)
}

pub fn workspace_session_launch_options_with_dynamic_registry(
    runtime_home: &Path,
    model_registry_store: &DynamicModelRegistryStore,
    workspace_id: Option<&str>,
) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> {
    Ok(workspace_session_launch_options_with_snapshots(
        runtime_home,
        Some(model_registry_store),
        workspace_id,
    ))
}

fn workspace_session_launch_options_with_snapshots(
    runtime_home: &Path,
    model_registry_store: Option<&DynamicModelRegistryStore>,
    workspace_id: Option<&str>,
) -> ResolvedWorkspaceLaunchOptions {
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
            let model_registry = model_registry_store
                .and_then(|store| store.get(&model_registry.kind, workspace_id).ok().flatten())
                .as_ref()
                .and_then(|snapshot| {
                    effective_registry_for_kind(&model_registry.kind, Some(snapshot))
                })
                .unwrap_or(model_registry);

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
                        default_opt_in: model.default_opt_in,
                    })
                    .collect(),
            })
        })
        .collect();

    ResolvedWorkspaceLaunchOptions { agents }
}
