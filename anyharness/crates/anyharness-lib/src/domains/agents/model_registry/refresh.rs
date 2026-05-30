use std::path::{Path, PathBuf};

use chrono::{Duration, Utc};

use crate::domains::agents::model::{
    AgentDescriptor, AgentKind, AgentProcessFallback, AgentProcessInstallSpec, ArtifactRole,
    ModelCatalogStatus, ResolvedAgentStatus,
};
use crate::domains::agents::readiness::resolver::{
    artifact_root, managed_registry_binary_for_names, resolve_agent,
};
use crate::integrations::agent_cli::executable::{
    find_real_binary_in_path, is_known_agent_wrapper,
};
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
    cwd: Option<&Path>,
    workspace_id: Option<String>,
    force_provider_refresh: bool,
    previous_models: Vec<DynamicModelRegistryModel>,
) -> DynamicModelRegistrySnapshot {
    let refreshed_at = Utc::now();
    let expires_at = Some(refreshed_at + Duration::hours(SNAPSHOT_TTL_HOURS));
    let kind = descriptor.kind.as_str().to_string();

    match refresh_models_for_descriptor(descriptor, runtime_home, cwd, force_provider_refresh) {
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
    cwd: Option<&Path>,
    force_provider_refresh: bool,
) -> Result<Vec<DynamicModelRegistryModel>, RefreshFailure> {
    if !supports_dynamic_model_discovery(&descriptor.kind) {
        return Err(RefreshFailure {
            status: DynamicModelRegistryStatus::Unsupported,
            message: "This agent does not support dynamic model discovery.".to_string(),
        });
    }

    let executable = resolve_discovery_executable(descriptor, runtime_home)?;
    let discovered = match descriptor.kind {
        AgentKind::Cursor => {
            discover_cursor_models(&executable, cwd).map_err(|error| RefreshFailure {
                status: DynamicModelRegistryStatus::RefreshFailed,
                message: error.to_string(),
            })?
        }
        AgentKind::OpenCode => discover_opencode_models(&executable, cwd, force_provider_refresh)
            .map_err(|error| RefreshFailure {
            status: DynamicModelRegistryStatus::RefreshFailed,
            message: error.to_string(),
        })?,
        AgentKind::Claude | AgentKind::Codex | AgentKind::Gemini => unreachable!(),
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
    let executable_names = discovery_executable_names(&descriptor.kind);
    if resolved.status == ResolvedAgentStatus::Ready {
        if let Some(path) = resolved
            .native
            .and_then(|native| native.path)
            .filter(|path| is_discovery_executable_name(path, executable_names))
        {
            return Ok(path);
        }
        if let Some(path) = managed_discovery_executable(descriptor, runtime_home, executable_names)
        {
            return Ok(path);
        }
        if let Some(path) = resolved.agent_process.path.filter(|path| {
            is_discovery_executable_name(path, executable_names) && !is_known_agent_wrapper(path)
        }) {
            return Ok(path);
        }
        if let Some(path) = resolved.spawn.and_then(|spawn| {
            is_discovery_executable_name(&spawn.program, executable_names).then_some(spawn.program)
        }) {
            return Ok(path);
        }
    }

    for candidate in executable_names {
        if let Some(path) = find_real_binary_in_path(candidate) {
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

fn supports_dynamic_model_discovery(kind: &AgentKind) -> bool {
    matches!(kind, AgentKind::Cursor | AgentKind::OpenCode)
}

fn discovery_executable_names(kind: &AgentKind) -> &'static [&'static str] {
    match kind {
        AgentKind::Cursor => &["cursor-agent"],
        AgentKind::OpenCode => &["opencode", "opencode-ai"],
        AgentKind::Claude | AgentKind::Codex | AgentKind::Gemini => &[],
    }
}

fn managed_discovery_executable(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    expected_names: &[&str],
) -> Option<PathBuf> {
    if let Some(path) =
        managed_registry_binary_for_names(runtime_home, &descriptor.kind, expected_names)
    {
        return Some(path);
    }

    let executable_relpath = managed_executable_relpath(&descriptor.agent_process.install)?;
    if !is_discovery_executable_name(executable_relpath, expected_names) {
        return None;
    }

    let path = artifact_root(runtime_home, &descriptor.kind, &ArtifactRole::AgentProcess)
        .join(executable_relpath);
    path.exists().then_some(path)
}

fn managed_executable_relpath(install: &AgentProcessInstallSpec) -> Option<&Path> {
    match install {
        AgentProcessInstallSpec::RegistryBacked {
            fallback:
                AgentProcessFallback::NpmPackage {
                    executable_relpath, ..
                },
            ..
        }
        | AgentProcessInstallSpec::ManagedNpmPackage {
            executable_relpath, ..
        } => Some(executable_relpath.as_path()),
        AgentProcessInstallSpec::RegistryBacked { .. }
        | AgentProcessInstallSpec::PathOnly { .. }
        | AgentProcessInstallSpec::Manual { .. } => None,
    }
}

fn is_discovery_executable_name(path: &Path, expected_names: &[&str]) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| expected_names.iter().any(|expected| expected == &name))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::readiness::resolver::artifact_root;
    use crate::domains::agents::registry::built_in_registry;
    use crate::integrations::agent_cli::executable::make_executable;

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    struct PathEnvGuard {
        original: Option<std::ffi::OsString>,
    }

    impl PathEnvGuard {
        fn set(path: &Path) -> Self {
            let original = std::env::var_os("PATH");
            let joined = std::env::join_paths([path]).expect("join PATH");
            std::env::set_var("PATH", joined);
            Self { original }
        }
    }

    impl Drop for PathEnvGuard {
        fn drop(&mut self) {
            if let Some(original) = &self.original {
                std::env::set_var("PATH", original);
            } else {
                std::env::remove_var("PATH");
            }
        }
    }

    #[test]
    fn managed_discovery_executable_uses_registry_binary() {
        let cursor = built_in_registry()
            .into_iter()
            .find(|descriptor| descriptor.kind == AgentKind::Cursor)
            .expect("missing Cursor descriptor");
        let runtime_home = make_temp_dir("anyharness-model-refresh-registry-binary-test");
        let binary_path = artifact_root(
            &runtime_home,
            &AgentKind::Cursor,
            &ArtifactRole::AgentProcess,
        )
        .join("registry_binary")
        .join("cursor-agent");
        std::fs::create_dir_all(binary_path.parent().expect("binary parent"))
            .expect("create registry binary dir");
        std::fs::write(&binary_path, "#!/bin/sh\nexit 0\n").expect("write binary");
        make_executable(&binary_path).expect("make binary executable");

        assert_eq!(
            managed_discovery_executable(&cursor, &runtime_home, &["cursor-agent"]),
            Some(binary_path)
        );

        let _ = std::fs::remove_dir_all(runtime_home);
    }

    #[test]
    fn discovery_executable_ignores_superset_wrapper_on_path() {
        let cursor = built_in_registry()
            .into_iter()
            .find(|descriptor| descriptor.kind == AgentKind::Cursor)
            .expect("missing Cursor descriptor");
        let runtime_home = make_temp_dir("anyharness-model-refresh-wrapper-runtime-test");
        let path_dir = make_temp_dir("anyharness-model-refresh-wrapper-path-test");
        let wrapper_path = path_dir.join("cursor-agent");
        std::fs::write(
            &wrapper_path,
            "#!/bin/sh\n# Superset agent-wrapper v3\nexec cursor-agent \"$@\"\n",
        )
        .expect("write wrapper");
        make_executable(&wrapper_path).expect("make wrapper executable");
        let _path_guard = PathEnvGuard::set(&path_dir);

        let failure = resolve_discovery_executable(&cursor, &runtime_home)
            .expect_err("wrapper path should not be usable for model discovery");

        assert_eq!(failure.status, DynamicModelRegistryStatus::AgentNotReady);

        let _ = std::fs::remove_dir_all(runtime_home);
        let _ = std::fs::remove_dir_all(path_dir);
    }
}
