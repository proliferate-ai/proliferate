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
    VersionDrift {
        pinned: String,
        recorded: String,
    },
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

/// The declared version pin for an agent-process install spec, when the spec
/// carries one (registry npm package pins). Native CLIs are attested, not
/// pinned, until the catalog supplies pins.
pub fn agent_process_pinned_version(spec: &AgentProcessInstallSpec) -> Option<String> {
    match spec {
        AgentProcessInstallSpec::ManagedNpmPackage { package, .. } => npm_package_version(package),
        AgentProcessInstallSpec::RegistryBacked { fallback, .. } => match fallback {
            crate::domains::agents::model::AgentProcessFallback::NpmPackage {
                package, ..
            } => npm_package_version(package),
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
        assert_eq!(plan_artifact(&facts(Some("0.25.0"), None, None), false), None);
        // No pin declared (unpinned native CLI): attested, never forced.
        assert_eq!(plan_artifact(&facts(None, Some("1.2.3"), None), false), None);
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
}
