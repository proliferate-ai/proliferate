use std::path::{Path, PathBuf};

use super::agent_process;
use super::install_policy::{effective_source, ResolvedPinSource};
use super::lock::AgentInstallLock;
use super::pinned;
use crate::domains::agents::installer::seed;
use crate::domains::agents::model::*;
use crate::domains::agents::readiness::paths::artifact_root;
use crate::integrations::agent_cli::executable::is_valid_executable;
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
    #[error("checksum mismatch for {url}: expected {expected}, got {actual}")]
    ChecksumMismatch {
        url: String,
        expected: String,
        actual: String,
    },
    #[error("pinned source has no download for this platform: {0}")]
    NoPinForPlatform(String),
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

    tracing::info!(
        agent = descriptor.kind.as_str(),
        reinstall = options.reinstall,
        native_version = ?options.native_version,
        agent_process_version = ?options.agent_process_version,
        runtime_home = %runtime_home.display(),
        "starting managed agent install"
    );

    // The catalog is the lockfile and the fence: every installable role must
    // declare a resolved source. No source => no install (never a latest-fetch,
    // PATH adoption, or ACP `/latest` re-fetch).
    if descriptor.native.is_some() {
        let native_options = options_for_role(options, &plan, &ArtifactRole::NativeCli);
        let source = require_source(catalog_pins, descriptor, &ArtifactRole::NativeCli)?;
        if let Some(result) = install_pinned_role(
            &source,
            super::install_policy::effective_pin(catalog_pins, descriptor, &ArtifactRole::NativeCli),
            &native_options,
            &descriptor.kind,
            &ArtifactRole::NativeCli,
            runtime_home,
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

    {
        let process_options = options_for_role(options, &plan, &ArtifactRole::AgentProcess);
        let source = require_source(catalog_pins, descriptor, &ArtifactRole::AgentProcess)?;
        let version = super::install_policy::effective_pin(
            catalog_pins,
            descriptor,
            &ArtifactRole::AgentProcess,
        );
        let result = pinned::install_agent_process_from_pin(
            &source,
            version.as_deref(),
            &descriptor.kind,
            &descriptor.launch.executable_name,
            runtime_home,
            process_options.reinstall,
        )?;
        if let Some(result) = result {
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

/// The fence: every installable role must carry a resolved source in the
/// active catalog lockfile. A missing source is a hard error — never a silent
/// fallback to a latest-fetch / PATH binary / ACP `/latest` re-fetch.
fn require_source(
    catalog_pins: Option<&super::install_policy::PinOverrides>,
    descriptor: &AgentDescriptor,
    role: &ArtifactRole,
) -> Result<ResolvedPinSource, InstallError> {
    effective_source(catalog_pins, role).ok_or_else(|| {
        InstallError::InvalidInstallSpec(format!(
            "{}: {} has no resolved source pin in the catalog lockfile",
            descriptor.kind.as_str(),
            super::manifest::role_name(role),
        ))
    })
}

/// Install one role from a fenced Binary/Archive pin (sha256-verified), with
/// the same idempotent skip as the legacy mechanisms: an already-installed
/// artifact is left alone unless the plan forced a reinstall.
fn install_pinned_role(
    source: &super::install_policy::ResolvedPinSource,
    version: Option<String>,
    options: &InstallOptions,
    kind: &AgentKind,
    role: &ArtifactRole,
    runtime_home: &Path,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    let target_path = artifact_root(runtime_home, kind, role).join(kind.as_str());
    if is_valid_executable(&target_path) && !options.reinstall {
        return Ok(None);
    }
    let result = pinned::install_binary_or_archive_from_pin(
        source,
        version.as_deref().unwrap_or_default(),
        kind,
        role,
        runtime_home,
    )?;
    Ok(Some(result))
}
