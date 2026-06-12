use std::path::{Path, PathBuf};

use super::agent_process::{self, install_agent_process_artifact, is_agent_process_installable};
use super::lock::AgentInstallLock;
use super::native::{install_native_artifact, is_native_installable};
use crate::domains::agents::model::*;
use crate::domains::agents::installer::seed;
use crate::integrations::agent_cli::launcher::LauncherError;

#[derive(Debug, Clone)]
pub struct InstalledArtifactResult {
    pub role: ArtifactRole,
    pub path: PathBuf,
    pub source: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct InstallOptions {
    pub reinstall: bool,
    pub native_version: Option<String>,
    pub agent_process_version: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("agent kind not installable via managed install")]
    NotInstallable,
    #[error("no compatible platform detected for native binary download")]
    UnsupportedPlatform,
    #[error("invalid install spec: {0}")]
    InvalidInstallSpec(String),
    #[error("failed to run install command `{program}`: {message}")]
    CommandFailed { program: String, message: String },
    #[error("managed artifact missing after install: {0}")]
    MissingManagedArtifact(PathBuf),
    #[error("network fetch failed: {url}: {message}")]
    FetchFailed { url: String, message: String },
    #[error("ACP registry error: {0}")]
    RegistryFailed(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<LauncherError> for InstallError {
    fn from(error: LauncherError) -> Self {
        match error {
            LauncherError::Io(error) => Self::Io(error),
            LauncherError::PathJoin(error) => Self::CommandFailed {
                program: "launcher".into(),
                message: error.to_string(),
            },
        }
    }
}

pub fn install_agent(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    options: &InstallOptions,
) -> Result<Vec<InstalledArtifactResult>, InstallError> {
    let _install_lock = AgentInstallLock::acquire_agent(runtime_home, &descriptor.kind)?;
    let mut installed = Vec::new();
    let mut has_installable = false;

    tracing::info!(
        agent = descriptor.kind.as_str(),
        reinstall = options.reinstall,
        native_version = ?options.native_version,
        agent_process_version = ?options.agent_process_version,
        runtime_home = %runtime_home.display(),
        "starting managed agent install"
    );

    if let Some(native_spec) = &descriptor.native {
        if is_native_installable(&native_spec.install) {
            has_installable = true;
            if let Some(result) =
                install_native_artifact(native_spec, &descriptor.kind, runtime_home, options)?
            {
                tracing::info!(
                    agent = descriptor.kind.as_str(),
                    role = "native_cli",
                    path = %result.path.display(),
                    source = %result.source,
                    version = ?result.version,
                    "installed managed agent artifact"
                );
                installed.push(result);
            }
        }
    }

    if is_agent_process_installable(&descriptor.agent_process.install) {
        has_installable = true;
        if let Some(result) = install_agent_process_artifact(
            &descriptor.agent_process,
            &descriptor.kind,
            &descriptor.launch.default_args,
            runtime_home,
            options,
        )? {
            tracing::info!(
                agent = descriptor.kind.as_str(),
                role = "agent_process",
                path = %result.path.display(),
                source = %result.source,
                version = ?result.version,
                "installed managed agent artifact"
            );
            installed.push(result);
        }
    }

    if !has_installable {
        return Err(InstallError::NotInstallable);
    }

    seed::mark_installed_artifacts_user_modified(runtime_home, &descriptor.kind, &installed);

    Ok(installed)
}

pub(crate) fn regenerate_seeded_agent_launchers(
    runtime_home: &Path,
    seeded_agents: &[String],
) -> Result<Vec<InstalledArtifactResult>, InstallError> {
    agent_process::regenerate_seeded_agent_launchers(runtime_home, seeded_agents)
}
