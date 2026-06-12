//! AgentRuntime: the agents domain facade. Sequences the concern services;
//! owns no mechanism, no translation, no policy.

use std::path::PathBuf;
use std::sync::Arc;

use super::auth::login::{self, AgentLoginError};
pub use super::auth::login::{AgentLoginCommand, ResolvedAgentLoginCommand};
use super::installer::reconcile::execution::{AgentReconcileJobSnapshot, AgentReconcileService};
use super::installer::seed::AgentSeedStore;
use super::installer::{self, InstallError, InstallOptions, InstalledArtifactResult};
use super::model::*;
use super::readiness::service::resolve_agent;
use super::registry::built_in_registry;

#[derive(Clone)]
pub struct AgentRuntime {
    runtime_home: PathBuf,
    reconcile_service: Arc<AgentReconcileService>,
    seed_store: AgentSeedStore,
    catalog_service: super::catalog::service::AgentCatalogService,
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
pub struct AgentLoginStart {
    pub kind: String,
    pub label: String,
    pub command: AgentLoginCommand,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub command_display: String,
    pub reuses_user_state: bool,
    pub message: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentRuntimeError {
    #[error("No built-in agent with kind: {0}")]
    NotFound(String),
    #[error(transparent)]
    Login(#[from] AgentLoginError),
    #[error("Agent login terminal not found: {0}")]
    LoginTerminalNotFound(String),
    #[error("Agent login terminal failed: {0}")]
    LoginTerminalFailed(String),
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
        catalog_service: super::catalog::service::AgentCatalogService,
    ) -> Self {
        Self {
            runtime_home,
            reconcile_service,
            seed_store,
            catalog_service,
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

    #[tracing::instrument(skip_all, err, fields(
        agent = %kind,
        reinstall = request.reinstall,
        native_version = ?request.native_version,
        agent_process_version = ?request.agent_process_version,
        runtime_home = %self.runtime_home.display(),
    ))]
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

        let install_runtime_home = self.runtime_home.clone();
        let install_descriptor = descriptor.clone();
        let catalog_pins = self.catalog_service.pin_overrides(kind);
        let installed_artifacts = tokio::task::spawn_blocking(move || {
            installer::install_agent_with_pins(
                &install_descriptor,
                &install_runtime_home,
                &options,
                catalog_pins.as_ref(),
            )
        })
        .await
        .map_err(AgentRuntimeError::InstallTaskFailed)??;

        self.seed_store.refresh_from_state(&self.runtime_home);
        let agent = resolve_agent(&descriptor, &self.runtime_home);
        let already_installed = installed_artifacts.is_empty();

        tracing::info!(
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
        let login_spec = descriptor
            .auth
            .primary_login()
            .ok_or_else(|| AgentRuntimeError::Login(AgentLoginError::NotSupported(kind.to_string())))?;
        let command = AgentLoginCommand {
            program: login_spec.command.program.clone(),
            args: login_spec.command.args.clone(),
        };

        Ok(AgentLoginStart {
            kind: descriptor.kind.as_str().to_string(),
            label: login_spec.label.clone(),
            command_display: login::display_command(&command),
            command,
            cwd: login::login_cwd(&self.runtime_home),
            env: Vec::new(),
            reuses_user_state: login_spec.reuses_user_state,
            message: login_spec.message.clone(),
        })
    }

    pub async fn start_login_terminal(
        &self,
        kind: &str,
    ) -> Result<AgentLoginStart, AgentRuntimeError> {
        let descriptor = descriptor_for_kind(kind)?;
        let login_spec = descriptor
            .auth
            .primary_login()
            .ok_or_else(|| AgentRuntimeError::Login(AgentLoginError::NotSupported(kind.to_string())))?;
        let resolved = login::resolve_login_command(&descriptor, &self.runtime_home)?;

        Ok(AgentLoginStart {
            kind: descriptor.kind.as_str().to_string(),
            label: login_spec.label.clone(),
            command: resolved.command,
            cwd: resolved.cwd,
            env: resolved.env,
            command_display: resolved.command_display,
            reuses_user_state: login_spec.reuses_user_state,
            message: login_spec.message.clone(),
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
                Some(self.catalog_service.clone()),
            )
            .await
    }
}

fn descriptor_for_kind(kind: &str) -> Result<AgentDescriptor, AgentRuntimeError> {
    super::registry::descriptor(kind).ok_or_else(|| AgentRuntimeError::NotFound(kind.to_string()))
}
