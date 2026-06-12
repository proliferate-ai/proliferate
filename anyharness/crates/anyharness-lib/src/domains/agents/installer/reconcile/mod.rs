use std::path::Path;

pub mod execution;

use crate::domains::agents::installer::{self, InstallError, InstallOptions, InstalledArtifactResult};
use crate::domains::agents::model::{AgentDescriptor, AgentKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentReconcileOutcome {
    Installed,
    AlreadyInstalled,
    Skipped,
    Failed,
}

#[derive(Debug, Clone)]
pub struct AgentReconcileResult {
    pub kind: AgentKind,
    pub outcome: AgentReconcileOutcome,
    pub message: Option<String>,
    pub installed_artifacts: Vec<InstalledArtifactResult>,
}

pub fn reconcile_agents(
    registry: &[AgentDescriptor],
    runtime_home: &Path,
    reinstall: bool,
) -> Vec<AgentReconcileResult> {
    reconcile_agents_with_pins(registry, runtime_home, reinstall, |_| None)
}

/// Reconcile with a catalog pin lookup (kind -> overrides) so the active v2
/// catalog's versions drive drift detection when present.
pub fn reconcile_agents_with_pins(
    registry: &[AgentDescriptor],
    runtime_home: &Path,
    reinstall: bool,
    pins_for: impl Fn(&str) -> Option<crate::domains::agents::installer::install_policy::PinOverrides>,
) -> Vec<AgentReconcileResult> {
    let options = InstallOptions {
        reinstall,
        ..Default::default()
    };

    registry
        .iter()
        .map(|descriptor| {
            let pins = pins_for(descriptor.kind.as_str());
            reconcile_agent(descriptor, runtime_home, &options, pins.as_ref())
        })
        .collect()
}

pub fn reconcile_agent(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    options: &InstallOptions,
    catalog_pins: Option<&crate::domains::agents::installer::install_policy::PinOverrides>,
) -> AgentReconcileResult {
    match installer::install_agent_with_pins(descriptor, runtime_home, options, catalog_pins) {
        Ok(artifacts) if artifacts.is_empty() => AgentReconcileResult {
            kind: descriptor.kind.clone(),
            outcome: AgentReconcileOutcome::AlreadyInstalled,
            message: None,
            installed_artifacts: vec![],
        },
        Ok(artifacts) => AgentReconcileResult {
            kind: descriptor.kind.clone(),
            outcome: AgentReconcileOutcome::Installed,
            message: None,
            installed_artifacts: artifacts,
        },
        Err(InstallError::NotInstallable) | Err(InstallError::UnsupportedPlatform) => {
            AgentReconcileResult {
                kind: descriptor.kind.clone(),
                outcome: AgentReconcileOutcome::Skipped,
                message: Some("Not installable via managed install".into()),
                installed_artifacts: vec![],
            }
        }
        Err(error) => {
            tracing::warn!(
                agent = descriptor.kind.as_str(),
                error = %error,
                "reconcile: install failed for agent"
            );
            AgentReconcileResult {
                kind: descriptor.kind.clone(),
                outcome: AgentReconcileOutcome::Failed,
                message: Some(error.to_string()),
                installed_artifacts: vec![],
            }
        }
    }
}
