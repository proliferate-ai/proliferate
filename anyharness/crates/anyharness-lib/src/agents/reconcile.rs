use std::path::Path;

use super::installer::{self, InstallError, InstallOptions, InstalledArtifactResult};
use super::model::{AgentDescriptor, AgentKind};

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
    let options = InstallOptions {
        reinstall,
        ..Default::default()
    };

    registry
        .iter()
        .map(|descriptor| reconcile_agent(descriptor, runtime_home, &options))
        .collect()
}

pub fn reconcile_agent(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    options: &InstallOptions,
) -> AgentReconcileResult {
    match installer::install_agent(descriptor, runtime_home, options) {
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
