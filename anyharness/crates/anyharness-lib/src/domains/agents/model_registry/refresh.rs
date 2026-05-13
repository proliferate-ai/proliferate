use std::path::{Path, PathBuf};

use chrono::{Duration, Utc};

use crate::domains::agents::model::{
    AgentDescriptor, AgentKind, ModelCatalogStatus, ResolvedAgentStatus,
};
use crate::domains::agents::readiness::resolver::resolve_agent;
use crate::integrations::agent_cli::executable::find_in_path;
use crate::integrations::agent_cli::model_discovery::{
    discover_cursor_models, discover_opencode_models, DiscoveredCliModel,
};

use super::model::{
    DynamicModelRegistryModel, DynamicModelRegistrySnapshot, DynamicModelRegistrySource,
    DynamicModelRegistryStatus,
};

const SNAPSHOT_TTL_HOURS: i64 = 24;

pub fn refresh_snapshot_for_descriptor(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    workspace_id: Option<String>,
    force_provider_refresh: bool,
    previous_models: Vec<DynamicModelRegistryModel>,
) -> DynamicModelRegistrySnapshot {
    let refreshed_at = Utc::now();
    let expires_at = Some(refreshed_at + Duration::hours(SNAPSHOT_TTL_HOURS));
    let kind = descriptor.kind.as_str().to_string();

    match refresh_models_for_descriptor(descriptor, runtime_home, force_provider_refresh) {
        Ok(models) => DynamicModelRegistrySnapshot {
            kind,
            workspace_id,
            source: DynamicModelRegistrySource::ProviderCli,
            status: DynamicModelRegistryStatus::Available,
            refreshed_at,
            expires_at,
            models,
            warnings: vec![],
            error_message: None,
        },
        Err(error) => DynamicModelRegistrySnapshot {
            kind,
            workspace_id,
            source: DynamicModelRegistrySource::ProviderCli,
            status: error.status,
            refreshed_at,
            expires_at,
            models: previous_models,
            warnings: vec![],
            error_message: Some(error.message),
        },
    }
}

struct RefreshFailure {
    status: DynamicModelRegistryStatus,
    message: String,
}

fn refresh_models_for_descriptor(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    force_provider_refresh: bool,
) -> Result<Vec<DynamicModelRegistryModel>, RefreshFailure> {
    let executable = resolve_discovery_executable(descriptor, runtime_home)?;
    let discovered = match descriptor.kind {
        AgentKind::Cursor => {
            discover_cursor_models(&executable).map_err(|error| RefreshFailure {
                status: DynamicModelRegistryStatus::RefreshFailed,
                message: error.to_string(),
            })?
        }
        AgentKind::OpenCode => discover_opencode_models(&executable, force_provider_refresh)
            .map_err(|error| RefreshFailure {
                status: DynamicModelRegistryStatus::RefreshFailed,
                message: error.to_string(),
            })?,
        AgentKind::Claude | AgentKind::Codex | AgentKind::Gemini => {
            return Err(RefreshFailure {
                status: DynamicModelRegistryStatus::Unsupported,
                message: "This agent does not support dynamic model discovery.".to_string(),
            });
        }
    };

    Ok(discovered
        .into_iter()
        .map(discovered_model_to_dynamic_model)
        .collect())
}

fn resolve_discovery_executable(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
) -> Result<PathBuf, RefreshFailure> {
    let resolved = resolve_agent(descriptor, runtime_home);
    if resolved.status == ResolvedAgentStatus::Ready {
        if let Some(program) = resolved.spawn.as_ref().map(|spawn| spawn.program.clone()) {
            return Ok(program);
        }
        if let Some(path) = resolved.agent_process.path.clone() {
            return Ok(path);
        }
        if let Some(path) = resolved.native.and_then(|native| native.path) {
            return Ok(path);
        }
    }

    if let Some(path) = find_in_path(&descriptor.launch.executable_name) {
        return Ok(path);
    }
    if descriptor.kind == AgentKind::OpenCode {
        if let Some(path) = find_in_path("opencode") {
            return Ok(path);
        }
    }

    Err(RefreshFailure {
        status: DynamicModelRegistryStatus::AgentNotReady,
        message: format!(
            "{} is not installed or authenticated enough to refresh models.",
            descriptor.kind.display_name()
        ),
    })
}

fn discovered_model_to_dynamic_model(model: DiscoveredCliModel) -> DynamicModelRegistryModel {
    DynamicModelRegistryModel {
        id: model.id,
        display_name: model.display_name,
        description: None,
        aliases: vec![],
        status: ModelCatalogStatus::Active,
        is_default: model.is_default,
        default_opt_in: None,
        provider: model.provider,
    }
}
