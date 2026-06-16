//! Pure plan-then-apply brain: (declared pins, install manifest, disk facts)
//! -> per-artifact reinstall decisions. No IO — the service gathers facts and
//! executes; this file only judges.
//!
//! Execution contract: the plan ESCALATES, never suppresses. An artifact the
//! plan leaves alone still goes through its mechanism's own idempotent skip
//! checks; a planned reinstall forces the mechanism to act. Pins come from the
//! registry install specs today; catalog v2 pins take over in the consumption
//! wave (PR-7b).

use crate::domains::agents::model::{AgentDescriptor, AgentProcessInstallSpec, ArtifactRole};

use super::managed_npm::npm_package_version;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReinstallReason {
    /// Caller explicitly asked (the Reinstall button).
    Requested,
    /// The manifest's recorded version no longer matches the declared pin.
    VersionDrift { pinned: String, recorded: String },
    /// The artifact on disk no longer matches the manifest's recorded hash.
    ChecksumMismatch,
}

impl std::fmt::Display for ReinstallReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Requested => write!(f, "requested"),
            Self::VersionDrift { pinned, recorded } => {
                write!(f, "version drift: pinned {pinned}, recorded {recorded}")
            }
            Self::ChecksumMismatch => write!(f, "checksum mismatch"),
        }
    }
}

/// The facts the service gathers per artifact role before planning.
#[derive(Debug, Clone, Default)]
pub struct ArtifactFacts {
    pub pinned_version: Option<String>,
    pub manifest_version: Option<String>,
    /// None when the manifest has no hash or the file is gone (mechanisms
    /// handle absence); Some(matches) when both sides were comparable.
    pub checksum_matches: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedArtifact {
    pub role: ArtifactRole,
    pub reinstall: Option<ReinstallReason>,
}

#[derive(Debug, Clone, Default)]
pub struct InstallPlan {
    pub artifacts: Vec<PlannedArtifact>,
}

impl InstallPlan {
    pub fn reinstall_for(&self, role: &ArtifactRole) -> Option<&ReinstallReason> {
        self.artifacts
            .iter()
            .find(|artifact| &artifact.role == role)
            .and_then(|artifact| artifact.reinstall.as_ref())
    }

    pub fn has_reinstalls(&self) -> bool {
        self.artifacts
            .iter()
            .any(|artifact| artifact.reinstall.is_some())
    }
}

/// Decide one artifact. Order: explicit request > version drift > corruption.
pub fn plan_artifact(facts: &ArtifactFacts, reinstall_requested: bool) -> Option<ReinstallReason> {
    if reinstall_requested {
        return Some(ReinstallReason::Requested);
    }
    if let (Some(pinned), Some(recorded)) = (&facts.pinned_version, &facts.manifest_version) {
        if pinned != recorded {
            return Some(ReinstallReason::VersionDrift {
                pinned: pinned.clone(),
                recorded: recorded.clone(),
            });
        }
    }
    if facts.checksum_matches == Some(false) {
        return Some(ReinstallReason::ChecksumMismatch);
    }
    None
}

/// Catalog-supplied pin overrides (the WHICH document wins over registry
/// specs when an active v2 catalog declares versions for this agent).
///
/// The `*_source` fields carry the resolved, fenced install source from the
/// lockfile. When present, the materializer downloads EXACTLY that (sha256
/// verified) instead of consulting the registry install spec.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PinOverrides {
    pub agent_process: Option<String>,
    pub native: Option<String>,
    pub agent_process_source: Option<ResolvedPinSource>,
    pub native_source: Option<ResolvedPinSource>,
}

/// Installer-domain mirror of `catalog::schema::AgentCatalogArtifactSource`
/// (kept here so `installer/` does not depend on `catalog/` structs). The
/// per-target `sha256` is the trust anchor enforced at download.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedPinSource {
    Binary {
        targets: std::collections::BTreeMap<String, ResolvedPinTarget>,
    },
    Archive {
        targets: std::collections::BTreeMap<String, ResolvedPinTarget>,
        args: Vec<String>,
    },
    Npm {
        package: String,
        sha256: Option<String>,
        args: Vec<String>,
    },
    Git {
        repo: String,
        git_ref: String,
        package_subdir: Option<String>,
        executable_relpath: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedPinTarget {
    pub url: String,
    pub sha256: String,
    pub expected_binary: Option<String>,
}

/// The effective pin: catalog override first, registry spec as the fallback.
pub fn effective_pin(
    overrides: Option<&PinOverrides>,
    descriptor: &AgentDescriptor,
    role: &ArtifactRole,
) -> Option<String> {
    let from_catalog = overrides.and_then(|overrides| match role {
        ArtifactRole::AgentProcess => overrides.agent_process.clone(),
        ArtifactRole::NativeCli => overrides.native.clone(),
    });
    from_catalog.or_else(|| pinned_version_for(descriptor, role))
}

/// The resolved, fenced install source for this role, when the active catalog
/// declares one. `None` means the legacy registry-spec path applies.
pub fn effective_source(
    overrides: Option<&PinOverrides>,
    role: &ArtifactRole,
) -> Option<ResolvedPinSource> {
    overrides.and_then(|overrides| match role {
        ArtifactRole::AgentProcess => overrides.agent_process_source.clone(),
        ArtifactRole::NativeCli => overrides.native_source.clone(),
    })
}

/// The declared version pin for an agent-process install spec, when the spec
/// carries one (registry npm package pins). Native CLIs are attested, not
/// pinned, until the catalog supplies pins.
pub fn agent_process_pinned_version(spec: &AgentProcessInstallSpec) -> Option<String> {
    match spec {
        AgentProcessInstallSpec::ManagedNpmPackage { package, .. } => npm_package_version(package),
        AgentProcessInstallSpec::RegistryBacked { fallback, .. } => match fallback {
            crate::domains::agents::model::AgentProcessFallback::NpmPackage { package, .. } => {
                npm_package_version(package)
            }
            _ => None,
        },
        _ => None,
    }
}

pub fn pinned_version_for(descriptor: &AgentDescriptor, role: &ArtifactRole) -> Option<String> {
    match role {
        ArtifactRole::AgentProcess => {
            agent_process_pinned_version(&descriptor.agent_process.install)
        }
        ArtifactRole::NativeCli => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(
        pinned: Option<&str>,
        recorded: Option<&str>,
        checksum_matches: Option<bool>,
    ) -> ArtifactFacts {
        ArtifactFacts {
            pinned_version: pinned.map(String::from),
            manifest_version: recorded.map(String::from),
            checksum_matches,
        }
    }

    #[test]
    fn matching_pin_and_manifest_keeps_the_artifact() {
        assert_eq!(
            plan_artifact(&facts(Some("0.24.2"), Some("0.24.2"), Some(true)), false),
            None
        );
    }

    #[test]
    fn version_drift_forces_reinstall() {
        assert_eq!(
            plan_artifact(&facts(Some("0.25.0"), Some("0.24.2"), Some(true)), false),
            Some(ReinstallReason::VersionDrift {
                pinned: "0.25.0".into(),
                recorded: "0.24.2".into(),
            })
        );
    }

    #[test]
    fn missing_manifest_or_pin_defers_to_the_mechanism() {
        // No manifest yet (fresh target): mechanisms decide install-vs-skip.
        assert_eq!(
            plan_artifact(&facts(Some("0.25.0"), None, None), false),
            None
        );
        // No pin declared (unpinned native CLI): attested, never forced.
        assert_eq!(
            plan_artifact(&facts(None, Some("1.2.3"), None), false),
            None
        );
    }

    #[test]
    fn checksum_mismatch_forces_reinstall() {
        assert_eq!(
            plan_artifact(&facts(Some("1.0.0"), Some("1.0.0"), Some(false)), false),
            Some(ReinstallReason::ChecksumMismatch)
        );
    }

    #[test]
    fn explicit_request_wins_over_everything() {
        assert_eq!(
            plan_artifact(&facts(Some("1.0.0"), Some("1.0.0"), Some(true)), true),
            Some(ReinstallReason::Requested)
        );
    }

    #[test]
    fn extracts_registry_npm_pins() {
        use crate::domains::agents::registry;
        let claude = registry::descriptor("claude").expect("claude descriptor");
        // The bundled claude agent-process spec pins a package version; the
        // policy must surface it (exact value comes from the registry doc).
        let pinned = pinned_version_for(&claude, &ArtifactRole::AgentProcess);
        assert!(pinned.is_some(), "claude agent process should carry a pin");
        // Native CLIs are attested, not pinned, in the registry era.
        assert_eq!(pinned_version_for(&claude, &ArtifactRole::NativeCli), None);
    }

    #[test]
    fn catalog_pin_overrides_registry_pin_and_falls_back() {
        use crate::domains::agents::registry;
        let claude = registry::descriptor("claude").expect("claude");
        let overrides = PinOverrides {
            agent_process: Some("9.9.9".into()),
            native: Some("2.0.0".into()),
            ..Default::default()
        };
        assert_eq!(
            effective_pin(Some(&overrides), &claude, &ArtifactRole::AgentProcess).as_deref(),
            Some("9.9.9")
        );
        assert_eq!(
            effective_pin(Some(&overrides), &claude, &ArtifactRole::NativeCli).as_deref(),
            Some("2.0.0")
        );
        // absent overrides fall back to the registry-derived pin
        assert_eq!(
            effective_pin(None, &claude, &ArtifactRole::AgentProcess),
            pinned_version_for(&claude, &ArtifactRole::AgentProcess)
        );
        assert_eq!(effective_pin(None, &claude, &ArtifactRole::NativeCli), None);
    }
}
