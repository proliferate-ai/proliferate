use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::installer::{self, InstallError, InstallOptions, InstalledArtifactResult};
use super::model::*;
use super::readiness::resolver::{managed_registry_binary_for_names, resolve_agent};
use super::reconcile::execution::{AgentReconcileJobSnapshot, AgentReconcileService};
use super::registry::built_in_registry;
use super::seed::AgentSeedStore;

#[derive(Clone)]
pub struct AgentRuntime {
    runtime_home: PathBuf,
    reconcile_service: Arc<AgentReconcileService>,
    seed_store: AgentSeedStore,
}

#[derive(Debug, Clone)]
pub struct AgentListSnapshot {
    pub agents: Vec<ResolvedAgent>,
    pub reconcile_snapshot: AgentReconcileJobSnapshot,
}

#[derive(Debug, Clone)]
pub struct AgentReadinessSnapshot {
    pub agent: ResolvedAgent,
    pub reconcile_snapshot: AgentReconcileJobSnapshot,
}

#[derive(Debug, Clone)]
pub struct AgentInstallRequest {
    pub reinstall: bool,
    pub native_version: Option<String>,
    pub agent_process_version: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AgentInstallOutcome {
    pub agent: ResolvedAgent,
    pub already_installed: bool,
    pub installed_artifacts: Vec<InstalledArtifactResult>,
}

#[derive(Debug, Clone)]
pub struct AgentLoginCommand {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct AgentLoginStart {
    pub kind: String,
    pub label: String,
    pub command: AgentLoginCommand,
    pub reuses_user_state: bool,
    pub message: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentRuntimeError {
    #[error("No built-in agent with kind: {0}")]
    NotFound(String),
    #[error("Agent {0} does not support native login")]
    LoginNotSupported(String),
    #[error("Agent install task failed: {0}")]
    InstallTaskFailed(tokio::task::JoinError),
    #[error(transparent)]
    Install(#[from] InstallError),
}

impl AgentRuntime {
    pub fn new(
        runtime_home: PathBuf,
        reconcile_service: Arc<AgentReconcileService>,
        seed_store: AgentSeedStore,
    ) -> Self {
        Self {
            runtime_home,
            reconcile_service,
            seed_store,
        }
    }

    pub async fn list_agents(&self) -> AgentListSnapshot {
        let registry = built_in_registry();
        let reconcile_snapshot = self.reconcile_service.snapshot().await;
        let agents = registry
            .iter()
            .map(|desc| resolve_agent(desc, &self.runtime_home))
            .collect();
        AgentListSnapshot {
            agents,
            reconcile_snapshot,
        }
    }

    pub async fn get_agent(&self, kind: &str) -> Result<AgentReadinessSnapshot, AgentRuntimeError> {
        let descriptor = descriptor_for_kind(kind)?;
        let reconcile_snapshot = self.reconcile_service.snapshot().await;
        Ok(AgentReadinessSnapshot {
            agent: resolve_agent(&descriptor, &self.runtime_home),
            reconcile_snapshot,
        })
    }

    pub async fn install_agent(
        &self,
        kind: &str,
        request: AgentInstallRequest,
    ) -> Result<AgentInstallOutcome, AgentRuntimeError> {
        let descriptor = descriptor_for_kind(kind)?;
        let options = InstallOptions {
            reinstall: request.reinstall,
            native_version: request.native_version,
            agent_process_version: request.agent_process_version,
        };

        tracing::info!(
            agent = %kind,
            reinstall = options.reinstall,
            native_version = ?options.native_version,
            agent_process_version = ?options.agent_process_version,
            runtime_home = %self.runtime_home.display(),
            "installing agent"
        );

        let install_runtime_home = self.runtime_home.clone();
        let install_descriptor = descriptor.clone();
        let install_options = options.clone();
        let installed_artifacts = tokio::task::spawn_blocking(move || {
            installer::install_agent(&install_descriptor, &install_runtime_home, &install_options)
        })
        .await
        .map_err(|error| {
            tracing::error!(
                agent = %kind,
                reinstall = options.reinstall,
                native_version = ?options.native_version,
                agent_process_version = ?options.agent_process_version,
                runtime_home = %self.runtime_home.display(),
                error = %error,
                "agent install task failed"
            );
            AgentRuntimeError::InstallTaskFailed(error)
        })?
        .map_err(|error| {
            tracing::error!(
                agent = %kind,
                reinstall = options.reinstall,
                native_version = ?options.native_version,
                agent_process_version = ?options.agent_process_version,
                runtime_home = %self.runtime_home.display(),
                error = %error,
                "agent install failed"
            );
            AgentRuntimeError::Install(error)
        })?;

        self.seed_store.refresh_from_state(&self.runtime_home);
        let agent = resolve_agent(&descriptor, &self.runtime_home);
        let already_installed = installed_artifacts.is_empty();

        tracing::info!(
            agent = %kind,
            already_installed,
            installed_artifact_count = installed_artifacts.len(),
            "agent install completed"
        );

        Ok(AgentInstallOutcome {
            agent,
            already_installed,
            installed_artifacts,
        })
    }

    pub async fn start_login(&self, kind: &str) -> Result<AgentLoginStart, AgentRuntimeError> {
        let descriptor = descriptor_for_kind(kind)?;
        let login = descriptor
            .auth
            .login
            .as_ref()
            .ok_or_else(|| AgentRuntimeError::LoginNotSupported(kind.to_string()))?;
        let command = managed_login_command(&descriptor, &self.runtime_home).unwrap_or_else(|| {
            AgentLoginCommand {
                program: login.command.program.clone(),
                args: login.command.args.clone(),
            }
        });

        Ok(AgentLoginStart {
            kind: descriptor.kind.as_str().to_string(),
            label: login.label.clone(),
            command,
            reuses_user_state: login.reuses_user_state,
            message: login.message.clone(),
        })
    }

    pub async fn reconcile_status(&self) -> AgentReconcileJobSnapshot {
        self.reconcile_service.snapshot().await
    }

    pub async fn start_reconcile(&self, reinstall: bool) -> AgentReconcileJobSnapshot {
        self.reconcile_service
            .start_or_get(
                built_in_registry(),
                self.runtime_home.clone(),
                reinstall,
                Some(self.seed_store.clone()),
            )
            .await
    }
}

fn descriptor_for_kind(kind: &str) -> Result<AgentDescriptor, AgentRuntimeError> {
    built_in_registry()
        .into_iter()
        .find(|descriptor| descriptor.kind.as_str() == kind)
        .ok_or_else(|| AgentRuntimeError::NotFound(kind.to_string()))
}

fn managed_login_command(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
) -> Option<AgentLoginCommand> {
    let login = descriptor.auth.login.as_ref()?;
    let resolved = resolve_agent(descriptor, runtime_home);
    if let Some(native) = resolved.native.as_ref() {
        if native.source.as_deref() != Some("path") {
            if let Some(path) = native.path.as_ref() {
                return Some(AgentLoginCommand {
                    program: path.display().to_string(),
                    args: login.command.args.clone(),
                });
            }
        }
    }

    if let Some(path) = managed_registry_binary_for_names(
        runtime_home,
        &descriptor.kind,
        &[login.command.program.as_str()],
    ) {
        return Some(AgentLoginCommand {
            program: path.display().to_string(),
            args: login.command.args.clone(),
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::readiness::resolver::artifact_root;
    use crate::integrations::agent_cli::executable::make_executable;

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn managed_login_command_uses_registry_binary_for_agent_process_installs() {
        let cursor = descriptor_for_kind("cursor").expect("cursor descriptor");
        let runtime_home = make_temp_dir("anyharness-login-registry-binary-test");
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

        let command = managed_login_command(&cursor, &runtime_home).expect("managed login command");

        assert_eq!(command.program, binary_path.display().to_string());
        assert_eq!(command.args, vec!["login".to_string()]);

        let _ = std::fs::remove_dir_all(runtime_home);
    }
}
