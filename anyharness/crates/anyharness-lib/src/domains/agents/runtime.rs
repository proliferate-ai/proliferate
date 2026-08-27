//! AgentRuntime: the agents domain facade. Sequences the concern services;
//! owns no mechanism, no translation, no policy.

use std::path::PathBuf;
use std::sync::Arc;

use super::auth::login::{self, AgentLoginError};
pub use super::auth::login::{AgentLoginCommand, ResolvedAgentLoginCommand};
use super::installer::reconcile::execution::{
    AgentReconcileAdmission, AgentReconcileJobSnapshot, AgentReconcileService,
    AgentReconcileStartError,
};
use super::installer::seed::AgentSeedStore;
use super::installer::{self, InstallError, InstallOptions, InstalledArtifactResult};
use super::launch_probe::{LaunchProbeService, PokeReason};
use super::model::*;
use super::readiness::service::resolve_agent;
use super::registry::built_in_registry;

#[derive(Clone)]
pub struct AgentRuntime {
    runtime_home: PathBuf,
    reconcile_service: Arc<AgentReconcileService>,
    seed_store: AgentSeedStore,
    catalog_service: super::catalog::service::AgentCatalogService,
    surface: RuntimeSurface,
    /// The probe engine, for the startup and install-completed pokes.
    ///
    /// `Option` so the reconcile suite can construct a runtime without standing up
    /// an engine — which would take a filesystem lock on a temp home and sweep it.
    /// `None` means "no pokes", never "probe anyway".
    launch_probe: Option<Arc<LaunchProbeService>>,
}

/// Which surface this runtime is serving. The auto-install pass needs it for
/// exactly one carve-out (agent-distribution.md, "Installation"):
///
/// > Cursor never installs in cloud. It is login-only with no headless credential
/// > path, so a cloud install could never reach `Ready`.
///
/// It is a constructor argument rather than an env read at the point of use so the
/// decision is a pure, testable function of its inputs — the alternative would put
/// a process-global read inside the reconcile loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RuntimeSurface {
    /// Desktop sidecar or a developer's local `anyharness serve`. Every supported
    /// harness may auto-install.
    #[default]
    Local,
    /// A cloud sandbox. Cursor is excluded (see above); everything else installs.
    Cloud,
}

/// The env var the cloud sandbox bootstrap sets to declare its surface
/// (`server/proliferate/server/cloud/runtime/bootstrap.py`). Absent means local,
/// which is the safe default: it can only ever ENABLE a cursor auto-install that
/// then fails to reach `Ready`, never suppress an install a surface needs.
pub const ANYHARNESS_RUNTIME_SURFACE_ENV: &str = "ANYHARNESS_RUNTIME_SURFACE";

impl RuntimeSurface {
    /// Read the surface from the process env once, at wiring time.
    pub fn from_env() -> Self {
        match std::env::var(ANYHARNESS_RUNTIME_SURFACE_ENV) {
            Ok(value) if value.trim().eq_ignore_ascii_case("cloud") => Self::Cloud,
            _ => Self::Local,
        }
    }
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
    #[error("Invalid reconcile agent kind: {0}")]
    InvalidReconcileAgentKind(String),
    #[error(transparent)]
    ReconcileStart(#[from] AgentReconcileStartError),
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
        surface: RuntimeSurface,
    ) -> Self {
        Self {
            runtime_home,
            reconcile_service,
            seed_store,
            catalog_service,
            surface,
            launch_probe: None,
        }
    }

    /// Attach the probe engine. Separate from [`AgentRuntime::new`] because the
    /// engine is built after the runtime in `app/mod.rs` and because a runtime
    /// without one is a legitimate configuration (every reconcile test).
    pub fn with_launch_probe(mut self, launch_probe: Arc<LaunchProbeService>) -> Self {
        self.launch_probe = Some(launch_probe);
        self
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

    #[tracing::instrument(skip_all, fields(
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
        let install_result = tokio::task::spawn_blocking(move || {
            installer::install_agent_with_pins(
                &install_descriptor,
                &install_runtime_home,
                &options,
                catalog_pins.as_ref(),
            )
        })
        .await;
        let installed_artifacts = match install_result {
            Ok(Ok(installed_artifacts)) => installed_artifacts,
            Ok(Err(error)) => {
                tracing::error!(
                    agent_kind = %kind,
                    error_kind = install_error_kind(&error),
                    "agent install failed"
                );
                return Err(AgentRuntimeError::Install(error));
            }
            Err(error) => {
                tracing::error!(
                    agent_kind = %kind,
                    error_kind = "task_join",
                    "agent install failed"
                );
                return Err(AgentRuntimeError::InstallTaskFailed(error));
            }
        };

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
        let login_spec = descriptor.auth.primary_login().ok_or_else(|| {
            AgentRuntimeError::Login(AgentLoginError::NotSupported(kind.to_string()))
        })?;
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
        let login_spec = descriptor.auth.primary_login().ok_or_else(|| {
            AgentRuntimeError::Login(AgentLoginError::NotSupported(kind.to_string()))
        })?;
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

    pub async fn start_reconcile(
        &self,
        reinstall: bool,
        installed_only: bool,
        agent_kinds: Vec<String>,
    ) -> Result<AgentReconcileJobSnapshot, AgentRuntimeError> {
        let mut requested_agent_kinds = Vec::with_capacity(agent_kinds.len());
        for kind in &agent_kinds {
            let parsed = AgentKind::parse(kind)
                .ok_or_else(|| AgentRuntimeError::InvalidReconcileAgentKind(kind.clone()))?;
            if !requested_agent_kinds.contains(&parsed) {
                requested_agent_kinds.push(parsed);
            }
        }
        let mut registry = built_in_registry();
        if !agent_kinds.is_empty() {
            registry.retain(|descriptor| requested_agent_kinds.contains(&descriptor.kind));
        }
        Ok(self
            .reconcile_service
            .start_with_admission(
                registry,
                self.runtime_home.clone(),
                reinstall,
                installed_only,
                requested_agent_kinds,
                Some(self.seed_store.clone()),
                Some(self.catalog_service.clone()),
                self.launch_probe.clone(),
                self.surface,
                AgentReconcileAdmission::ReuseCompatible,
            )
            .await?)
    }

    /// Internal startup/catalog pokes must not disappear merely because a
    /// foreground scoped update owns the one observable reconcile slot. Wait
    /// for that job to settle, then atomically admit a fresh pass against the
    /// latest catalog. HTTP callers retain compatible reuse.
    ///
    /// The pass is **full scope**, not installed-only. agent-distribution.md,
    /// "Installation": *"Installation is automatic. Every harness supported on a
    /// surface converges with no user action: absent means install, drifted means
    /// reinstall, and both are the same mechanism… A user authenticates harnesses;
    /// they never install them."* With `installed_only`, an absent opencode or
    /// grok was explicitly `Skipped` and stayed `InstallRequired` until a user
    /// clicked install — and session create then rejected the harness rather than
    /// converging it.
    ///
    /// The two carve-outs the law names are NOT dropped with the flag; they move
    /// into `auto_install_decision` (installer/auto_install.rs) where they are a
    /// tested predicate rather than a side effect of a boolean.
    pub async fn reconcile_when_idle(&self) {
        loop {
            let result = self
                .reconcile_service
                .start_with_admission(
                    built_in_registry(),
                    self.runtime_home.clone(),
                    false,
                    // Full scope: install what is absent, reinstall what drifted.
                    false,
                    Vec::new(),
                    Some(self.seed_store.clone()),
                    Some(self.catalog_service.clone()),
                    self.launch_probe.clone(),
                    self.surface,
                    AgentReconcileAdmission::RequireIdle,
                )
                .await;
            match result {
                Ok(_) => return,
                Err(AgentReconcileStartError::Busy(job_id)) => {
                    tracing::debug!(
                        active_job_id = %job_id,
                        "internal reconcile poke waiting for active job"
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
            }
        }
    }

    /// Runtime startup pass (desktop sidecar AND cloud workers): hydrate the
    /// bundled agent seed if it hasn't been laid down yet, then reconcile the
    /// full supported set to the catalog's pins — installing what is absent and
    /// reinstalling what drifted.
    ///
    /// Non-blocking (boots the HTTP server immediately), best-effort (failures
    /// are recorded in the seed/reconcile snapshots, never fatal), and
    /// idempotent: an up-to-date machine does no work. Seed hydration still runs
    /// first, so seeded agents are already present and the pass is a no-op for
    /// them rather than a redundant download.
    pub fn spawn_startup_pass(self: Arc<Self>) {
        tokio::spawn(async move {
            // Zeroth step: the native-migration bridge's one-time seed pass
            // (`route_auth::native_bridge`). Runs before any install so the
            // "existing native harness" it reads is the machine as the user
            // left it, not one this pass is about to change. One file read
            // plus per-harness credential detection; inert after the first
            // run on a runtime home.
            {
                let home = self.runtime_home.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    super::route_auth::seed_native_bridge_at_startup(&home);
                })
                .await;
            }
            if self.seed_store.hydration_pending() {
                let home = self.runtime_home.clone();
                let store = self.seed_store.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    installer::seed::hydrate_configured_agent_seed(&home, &store);
                })
                .await;
            }
            self.reconcile_when_idle().await;
            // Third step: refresh target-observed launch options. One poke covers
            // both a fresh cloud sandbox probing itself after user auth lands and a
            // desktop restarting after its harness or auth world changed. No
            // first-boot or static-catalog branch exists: startup is an unconditional
            // observation trigger.
            //
            // It makes NO ordering claim about installs. `reconcile_when_idle`
            // returns at ADMISSION, not completion (`start_with_admission` spawns the
            // job and returns its snapshot), so this poke genuinely races the installs
            // it follows. That is harmless and deliberate: an entry evaluated against
            // a mid-install attempt may probe the old binary, which is a correct
            // observation of the machine as it is right now. The
            // guarantee of a re-probe against the NEW binary is the per-agent
            // completion poke inside the reconcile job, which is precise about which
            // harness just changed.
            self.poke_launch_probes(PokeReason::Startup);
        });
    }

    /// The startup pass's third step, named so it can be asserted without driving a
    /// real install pass (which would download every supported harness into the
    /// test's temp home). A runtime with no engine attached pokes nothing.
    pub(crate) fn poke_launch_probes(&self, reason: PokeReason) {
        LaunchProbeService::poke_all_optional(&self.launch_probe, reason);
    }
}

fn descriptor_for_kind(kind: &str) -> Result<AgentDescriptor, AgentRuntimeError> {
    super::registry::descriptor(kind).ok_or_else(|| AgentRuntimeError::NotFound(kind.to_string()))
}

fn install_error_kind(error: &InstallError) -> &'static str {
    match error {
        InstallError::NotInstallable => "not_installable",
        InstallError::UnsupportedPlatform => "unsupported_platform",
        InstallError::InvalidInstallSpec(_) => "invalid_install_spec",
        InstallError::CommandFailed { .. } => "command_failed",
        InstallError::MissingManagedArtifact(_) => "missing_managed_artifact",
        InstallError::FetchFailed { .. } => "fetch_failed",
        InstallError::RegistryFailed(_) => "registry_failed",
        InstallError::ChecksumMismatch { .. } => "checksum_mismatch",
        InstallError::NoPinForPlatform(_) => "no_pin_for_platform",
        InstallError::Io(_) => "io",
    }
}

#[cfg(test)]
mod telemetry_tests {
    use super::{install_error_kind, InstallError};

    #[test]
    fn install_errors_emit_only_stable_classifications() {
        let error = InstallError::CommandFailed {
            program: "provider-installer".to_string(),
            message: "Bearer raw-provider-secret at /Users/customer/private".to_string(),
        };

        assert_eq!(install_error_kind(&error), "command_failed");
        assert!(!install_error_kind(&error).contains("raw-provider-secret"));
    }
}
