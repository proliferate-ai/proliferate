use std::path::{Path, PathBuf};

use super::agent_process;
use super::install_policy::{effective_source, ResolvedPinSource};
use super::lock::AgentInstallLock;
use super::pinned;
use super::progress::{InstallProgressPhase, InstallProgressReporter};
use crate::domains::agents::installer::seed;
use crate::domains::agents::model::*;
use crate::domains::agents::readiness::paths::managed_pinned_binary_path;
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

/// One truthful classification of an install failure, threaded additively from
/// the installer through reconcile → contract → HTTP → toast so a terminal
/// failure can name WHY (Update Flow R2.5 / PRO-115) instead of collapsing to
/// an opaque `error.to_string()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallErrorKind {
    /// A network fetch failed (download unreachable / interrupted / registry).
    Network,
    /// A downloaded artifact did not match its pinned sha256.
    Checksum,
    /// The live artifact could not be replaced because it is in use / busy /
    /// permission-blocked while running.
    InUse,
    /// The disk is full (ENOSPC).
    Disk,
    /// Anything else (invalid spec, missing artifact, unclassified io).
    Other,
}

impl InstallErrorKind {
    /// Stable machine token for the contract/HTTP surface and toast copy.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Network => "network",
            Self::Checksum => "checksum",
            Self::InUse => "in_use",
            Self::Disk => "disk",
            Self::Other => "other",
        }
    }
}

impl InstallError {
    /// Classify this failure into the typed enum. Io errors are inspected for
    /// the OS-specific "no space" and "busy/permission-on-live" cases so the
    /// UI can say "disk full" or "in use" rather than a raw errno.
    pub fn kind(&self) -> InstallErrorKind {
        match self {
            Self::FetchFailed { .. } | Self::RegistryFailed(_) => InstallErrorKind::Network,
            Self::ChecksumMismatch { .. } => InstallErrorKind::Checksum,
            Self::Io(error) => io_error_kind(error),
            _ => InstallErrorKind::Other,
        }
    }
}

fn io_error_kind(error: &std::io::Error) -> InstallErrorKind {
    use std::io::ErrorKind;
    if error.kind() == ErrorKind::PermissionDenied {
        return InstallErrorKind::InUse;
    }
    if let Some(code) = error.raw_os_error() {
        // ENOSPC = disk full; ETXTBSY / EBUSY = live artifact in use.
        const ENOSPC: i32 = 28;
        const EBUSY: i32 = 16;
        // ETXTBSY is 26 on Linux and macOS.
        const ETXTBSY: i32 = 26;
        match code {
            ENOSPC => return InstallErrorKind::Disk,
            EBUSY | ETXTBSY => return InstallErrorKind::InUse,
            _ => {}
        }
    }
    InstallErrorKind::Other
}

impl From<LauncherError> for InstallError {
    fn from(error: LauncherError) -> Self {
        match error {
            LauncherError::Io(error) => Self::Io(error),
            LauncherError::PathJoin(error) => Self::CommandFailed {
                program: "launcher".into(),
                message: error.to_string(),
            },
            LauncherError::UnsupportedBatchValue(value) => Self::InvalidInstallSpec(format!(
                "windows batch launcher cannot embed a literal '\"' in value: {value:?}"
            )),
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
    install_agent_with_pins_and_progress(descriptor, runtime_home, options, catalog_pins, None)
}

pub fn install_agent_with_pins_and_progress(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    options: &InstallOptions,
    catalog_pins: Option<&super::install_policy::PinOverrides>,
    reporter: Option<&InstallProgressReporter>,
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
            super::install_policy::effective_pin(
                catalog_pins,
                descriptor,
                &ArtifactRole::NativeCli,
            ),
            &native_options,
            &descriptor.kind,
            &ArtifactRole::NativeCli,
            runtime_home,
            reporter,
        )? {
            if let Some(reporter) = reporter {
                reporter.report(
                    &ArtifactRole::NativeCli,
                    InstallProgressPhase::Completed,
                    0,
                    None,
                )
            }
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
            reporter,
        )?;
        if let Some(result) = result {
            if let Some(reporter) = reporter {
                reporter.report(
                    &ArtifactRole::AgentProcess,
                    InstallProgressPhase::Completed,
                    0,
                    None,
                )
            }
            tracing::info!(
                agent = descriptor.kind.as_str(),
                role = "agent_process",
                path = %result.path.display(),
                source = %result.source,
                version = ?result.version,
                "installed managed agent artifact"
            );
            installed.push(result);
        } else {
            if let Some(reporter) = reporter {
                reporter.report(
                    &ArtifactRole::AgentProcess,
                    InstallProgressPhase::Skipped,
                    0,
                    None,
                )
            }
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
                missing_companion: missing_pinned_companion(
                    runtime_home,
                    &descriptor.kind,
                    &role,
                    catalog_pins,
                ),
            };
            PlannedArtifact {
                reinstall: plan_artifact(&facts, reinstall_requested),
                role,
            }
        })
        .collect();
    super::install_policy::InstallPlan { artifacts }
}

/// The first companion the active pin declares for this role that is not an
/// executable on disk. Companions are pinned per platform; one the pin does
/// not resolve for this platform is not "missing" — there is nothing to
/// install.
fn missing_pinned_companion(
    runtime_home: &Path,
    kind: &AgentKind,
    role: &ArtifactRole,
    catalog_pins: Option<&super::install_policy::PinOverrides>,
) -> Option<String> {
    let Some(super::install_policy::ResolvedPinSource::Archive { companions, .. }) =
        super::install_policy::effective_source(catalog_pins, role)
    else {
        return None;
    };
    let platform_key = Platform::detect()?.registry_key().to_string();
    companions
        .iter()
        .filter(|companion| companion.targets.contains_key(&platform_key))
        .find(|companion| {
            !is_valid_executable(&super::pinned::companion_path(
                runtime_home,
                kind,
                role,
                &companion.name,
            ))
        })
        .map(|companion| companion.name.clone())
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
    reporter: Option<&InstallProgressReporter>,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    let target_path = managed_pinned_binary_path(runtime_home, kind, role);
    if is_valid_executable(&target_path) && !options.reinstall {
        if let Some(reporter) = reporter {
            reporter.report(role, InstallProgressPhase::Skipped, 0, None)
        }
        return Ok(None);
    }
    let result = pinned::install_binary_or_archive_from_pin(
        source,
        version.as_deref().unwrap_or_default(),
        kind,
        role,
        runtime_home,
        reporter,
    )?;
    Ok(Some(result))
}

#[cfg(test)]
mod install_error_kind_tests {
    use super::*;

    #[test]
    fn maps_each_install_error_to_its_typed_kind() {
        let cases: Vec<(InstallError, InstallErrorKind)> = vec![
            (
                InstallError::FetchFailed {
                    url: "https://x".into(),
                    message: "boom".into(),
                },
                InstallErrorKind::Network,
            ),
            (
                InstallError::RegistryFailed("down".into()),
                InstallErrorKind::Network,
            ),
            (
                InstallError::ChecksumMismatch {
                    url: "https://x".into(),
                    expected: "a".into(),
                    actual: "b".into(),
                },
                InstallErrorKind::Checksum,
            ),
            (
                InstallError::Io(std::io::Error::from_raw_os_error(28)),
                InstallErrorKind::Disk,
            ),
            (
                InstallError::Io(std::io::Error::from_raw_os_error(26)),
                InstallErrorKind::InUse,
            ),
            (
                InstallError::Io(std::io::Error::from_raw_os_error(16)),
                InstallErrorKind::InUse,
            ),
            (
                InstallError::Io(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "busy",
                )),
                InstallErrorKind::InUse,
            ),
            (
                InstallError::InvalidInstallSpec("nope".into()),
                InstallErrorKind::Other,
            ),
            (
                InstallError::MissingManagedArtifact(PathBuf::from("/x")),
                InstallErrorKind::Other,
            ),
            (
                InstallError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "gone")),
                InstallErrorKind::Other,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(error.kind(), expected, "mismatch for {error:?}");
        }
    }

    #[test]
    fn kind_tokens_are_stable() {
        assert_eq!(InstallErrorKind::Network.as_str(), "network");
        assert_eq!(InstallErrorKind::Checksum.as_str(), "checksum");
        assert_eq!(InstallErrorKind::InUse.as_str(), "in_use");
        assert_eq!(InstallErrorKind::Disk.as_str(), "disk");
        assert_eq!(InstallErrorKind::Other.as_str(), "other");
    }
}
