use std::path::{Path, PathBuf};

use super::agent_process::{self, install_agent_process_artifact, is_agent_process_installable};
use super::lock::AgentInstallLock;
use super::native::{install_native_artifact, is_native_installable};
use crate::domains::agents::installer::seed;
use crate::domains::agents::model::*;
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
    install_agent_with_pins(descriptor, runtime_home, options, None)
}

/// Install with catalog-supplied pin overrides (the v2-era path: catalog owns
/// WHICH versions; the registry spec is the fallback).
pub fn install_agent_with_pins(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    options: &InstallOptions,
    catalog_pins: Option<&super::install_policy::PinOverrides>,
) -> Result<Vec<InstalledArtifactResult>, InstallError> {
    let _install_lock = AgentInstallLock::acquire_agent(runtime_home, &descriptor.kind)?;
    let plan = plan_for_descriptor(descriptor, runtime_home, options.reinstall, catalog_pins);
    if plan.has_reinstalls() {
        for artifact in &plan.artifacts {
            if let Some(reason) = &artifact.reinstall {
                tracing::info!(
                    agent = descriptor.kind.as_str(),
                    role = super::manifest::role_name(&artifact.role),
                    reason = %reason,
                    "install plan forces reinstall"
                );
            }
        }
    }
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
            let native_options = options_for_role(options, &plan, &ArtifactRole::NativeCli);
            if let Some(result) = install_native_artifact(
                native_spec,
                &descriptor.kind,
                runtime_home,
                &native_options,
            )? {
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
        let process_options = options_for_role(options, &plan, &ArtifactRole::AgentProcess);
        if let Some(result) = install_agent_process_artifact(
            &descriptor.agent_process,
            &descriptor.kind,
            &descriptor.launch.default_args,
            runtime_home,
            &process_options,
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
    if let Err(error) =
        super::manifest::record_artifacts(runtime_home, descriptor.kind.as_str(), &installed)
    {
        tracing::warn!(
            agent = descriptor.kind.as_str(),
            error = %error,
            "failed to write install manifest"
        );
    }

    Ok(installed)
}

pub(crate) fn regenerate_seeded_agent_launchers(
    runtime_home: &Path,
    seeded_agents: &[String],
) -> Result<Vec<InstalledArtifactResult>, InstallError> {
    agent_process::regenerate_seeded_agent_launchers(runtime_home, seeded_agents)
}

/// Gather durable facts (manifest, pins, content hashes) and plan the agent's
/// install. Pure judgment lives in install_policy; this gathers and executes.
pub(crate) fn plan_for_descriptor(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    reinstall_requested: bool,
    catalog_pins: Option<&super::install_policy::PinOverrides>,
) -> super::install_policy::InstallPlan {
    use super::install_policy::{effective_pin, plan_artifact, ArtifactFacts, PlannedArtifact};

    let manifest = super::manifest::read_manifest(runtime_home, descriptor.kind.as_str());
    let mut roles = Vec::new();
    if descriptor.native.is_some() {
        roles.push(ArtifactRole::NativeCli);
    }
    roles.push(ArtifactRole::AgentProcess);

    let artifacts = roles
        .into_iter()
        .map(|role| {
            let entry = manifest.as_ref().and_then(|manifest| {
                manifest
                    .artifacts
                    .iter()
                    .find(|artifact| artifact.role == super::manifest::role_name(&role))
            });
            let checksum_matches = entry.and_then(|entry| {
                let recorded = entry.sha256.as_ref()?;
                let observed = super::manifest::sha256_of_file(Path::new(&entry.path))?;
                Some(&observed == recorded)
            });
            let facts = ArtifactFacts {
                pinned_version: effective_pin(catalog_pins, descriptor, &role),
                manifest_version: entry.and_then(|entry| entry.version.clone()),
                checksum_matches,
            };
            PlannedArtifact {
                reinstall: plan_artifact(&facts, reinstall_requested),
                role,
            }
        })
        .collect();
    super::install_policy::InstallPlan { artifacts }
}

fn options_for_role(
    options: &InstallOptions,
    plan: &super::install_policy::InstallPlan,
    role: &ArtifactRole,
) -> InstallOptions {
    InstallOptions {
        reinstall: options.reinstall || plan.reinstall_for(role).is_some(),
        native_version: options.native_version.clone(),
        agent_process_version: options.agent_process_version.clone(),
    }
}
