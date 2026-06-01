use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::installer::{self, InstallError, InstallOptions, InstalledArtifactResult};
use super::model::*;
use super::readiness::paths::{
    artifact_root, managed_registry_binary_for_names, managed_registry_npm_binary_for_names,
};
use super::readiness::resolver::resolve_agent;
use super::reconcile::execution::{AgentReconcileJobSnapshot, AgentReconcileService};
use super::registry::built_in_registry;
use super::seed::AgentSeedStore;
use crate::domains::agents::seed;
use crate::integrations::agent_cli::executable::{find_in_path, is_valid_executable};

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
pub struct ResolvedAgentLoginCommand {
    pub command: AgentLoginCommand,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub command_display: String,
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
    #[error("Agent {0} does not support native login")]
    LoginNotSupported(String),
    #[error("Login command for agent {0} was not found")]
    LoginCommandNotFound(String),
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
        let command = AgentLoginCommand {
            program: login.command.program.clone(),
            args: login.command.args.clone(),
        };

        Ok(AgentLoginStart {
            kind: descriptor.kind.as_str().to_string(),
            label: login.label.clone(),
            command_display: display_command(&command),
            command,
            cwd: login_cwd(&self.runtime_home),
            env: Vec::new(),
            reuses_user_state: login.reuses_user_state,
            message: login.message.clone(),
        })
    }

    pub async fn start_login_terminal(
        &self,
        kind: &str,
    ) -> Result<AgentLoginStart, AgentRuntimeError> {
        let descriptor = descriptor_for_kind(kind)?;
        let login = descriptor
            .auth
            .login
            .as_ref()
            .ok_or_else(|| AgentRuntimeError::LoginNotSupported(kind.to_string()))?;
        let resolved = resolve_login_command(&descriptor, &self.runtime_home)?;

        Ok(AgentLoginStart {
            kind: descriptor.kind.as_str().to_string(),
            label: login.label.clone(),
            command: resolved.command,
            cwd: resolved.cwd,
            env: resolved.env,
            command_display: resolved.command_display,
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
) -> Option<(AgentLoginCommand, Vec<PathBuf>)> {
    let login = descriptor.auth.login.as_ref()?;
    let resolved = resolve_agent(descriptor, runtime_home);
    if let Some(native) = resolved.native.as_ref() {
        if native.source.as_deref() != Some("path") {
            if let Some(path) = native.path.as_ref() {
                let prefixes = login_path_prefixes(runtime_home, &descriptor.kind, path);
                return Some(AgentLoginCommand {
                    program: path.display().to_string(),
                    args: login.command.args.clone(),
                })
                .map(|command| (command, prefixes));
            }
        }
    }

    if let Some(path) = managed_registry_binary_for_names(
        runtime_home,
        &descriptor.kind,
        &[login.command.program.as_str()],
    ) {
        let prefixes = login_path_prefixes(runtime_home, &descriptor.kind, &path);
        return Some(AgentLoginCommand {
            program: path.display().to_string(),
            args: login.command.args.clone(),
        })
        .map(|command| (command, prefixes));
    }

    if let Some(path) = managed_registry_npm_binary_for_names(
        runtime_home,
        &descriptor.kind,
        &[login.command.program.as_str()],
    ) {
        let prefixes = login_path_prefixes(runtime_home, &descriptor.kind, &path);
        return Some(AgentLoginCommand {
            program: path.display().to_string(),
            args: login.command.args.clone(),
        })
        .map(|command| (command, prefixes));
    }

    None
}

fn resolve_login_command(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
) -> Result<ResolvedAgentLoginCommand, AgentRuntimeError> {
    let login = descriptor
        .auth
        .login
        .as_ref()
        .ok_or_else(|| AgentRuntimeError::LoginNotSupported(descriptor.kind.as_str().into()))?;

    let (command, path_prefixes) =
        if let Some((command, prefixes)) = managed_login_command(descriptor, runtime_home) {
            (command, prefixes)
        } else if let Some(path) = resolve_path_login_program(&login.command.program) {
            (
                AgentLoginCommand {
                    program: path.display().to_string(),
                    args: login.command.args.clone(),
                },
                path.parent().map(Path::to_path_buf).into_iter().collect(),
            )
        } else {
            return Err(AgentRuntimeError::LoginCommandNotFound(
                descriptor.kind.as_str().into(),
            ));
        };

    let command_display = display_command(&command);
    Ok(ResolvedAgentLoginCommand {
        command,
        cwd: login_cwd(runtime_home),
        env: login_env(path_prefixes),
        command_display,
    })
}

fn resolve_path_login_program(program: &str) -> Option<PathBuf> {
    let path = PathBuf::from(program);
    if path.components().count() > 1 {
        return is_valid_executable(&path).then_some(path);
    }
    find_in_path(program)
}

fn login_cwd(runtime_home: &Path) -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| runtime_home.to_path_buf())
}

fn login_path_prefixes(runtime_home: &Path, kind: &AgentKind, program: &Path) -> Vec<PathBuf> {
    let mut prefixes = Vec::new();
    if let Some(parent) = program.parent() {
        prefixes.push(parent.to_path_buf());
    }
    prefixes.push(artifact_root(runtime_home, kind, &ArtifactRole::NativeCli));
    prefixes.push(artifact_root(
        runtime_home,
        kind,
        &ArtifactRole::AgentProcess,
    ));
    if let Some(node) = seed::bundled_node_bin(runtime_home) {
        if let Some(parent) = node.parent() {
            prefixes.push(parent.to_path_buf());
        }
    }
    dedupe_paths(prefixes)
}

fn login_env(path_prefixes: Vec<PathBuf>) -> Vec<(String, String)> {
    if path_prefixes.is_empty() {
        return Vec::new();
    }
    let mut paths = path_prefixes;
    if let Some(existing) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&existing));
    }
    match std::env::join_paths(paths) {
        Ok(joined) => vec![("PATH".into(), joined.to_string_lossy().to_string())],
        Err(_) => Vec::new(),
    }
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn display_command(command: &AgentLoginCommand) -> String {
    std::iter::once(command.program.as_str())
        .chain(command.args.iter().map(String::as_str))
        .map(shell_quote_display)
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_quote_display(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || "_@%+=:,./-".contains(ch))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::readiness::paths::artifact_root;
    use crate::integrations::agent_cli::executable::make_executable;
    use std::sync::{Mutex, OnceLock};

    static ENV_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex")
    }

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

        let (command, prefixes) =
            managed_login_command(&cursor, &runtime_home).expect("managed login command");

        assert_eq!(command.program, binary_path.display().to_string());
        assert_eq!(command.args, vec!["login".to_string()]);
        assert!(prefixes.contains(&binary_path.parent().expect("binary parent").to_path_buf()));

        let _ = std::fs::remove_dir_all(runtime_home);
    }

    #[test]
    fn resolve_login_command_uses_managed_gemini_registry_npm_without_path() {
        let _env_lock = env_lock();
        let gemini = descriptor_for_kind("gemini").expect("gemini descriptor");
        let runtime_home = make_temp_dir("anyharness-login-managed-gemini-npm-test");
        let binary_path = artifact_root(
            &runtime_home,
            &AgentKind::Gemini,
            &ArtifactRole::AgentProcess,
        )
        .join("registry_npm")
        .join("node_modules")
        .join(".bin")
        .join("gemini");
        std::fs::create_dir_all(binary_path.parent().expect("binary parent"))
            .expect("create registry npm bin dir");
        std::fs::write(&binary_path, "#!/bin/sh\nexit 0\n").expect("write binary");
        make_executable(&binary_path).expect("make binary executable");
        let _guard = PathEnvGuard::clear();

        let resolved = resolve_login_command(&gemini, &runtime_home).expect("resolve login");

        assert_eq!(resolved.command.program, binary_path.display().to_string());
        assert!(resolved.env.iter().any(|(key, value)| key == "PATH"
            && value.starts_with(binary_path.parent().unwrap().to_str().unwrap())));

        let _ = std::fs::remove_dir_all(runtime_home);
    }

    #[test]
    fn resolve_login_command_uses_path_only_when_binary_exists() {
        let _env_lock = env_lock();
        let mut gemini = descriptor_for_kind("gemini").expect("gemini descriptor");
        gemini.auth.login.as_mut().expect("login").command.program =
            "anyharness-test-gemini".into();
        let runtime_home = make_temp_dir("anyharness-login-path-test");
        let bin_dir = make_temp_dir("anyharness-login-path-bin-test");
        let binary_path = bin_dir.join("anyharness-test-gemini");
        std::fs::write(&binary_path, "#!/bin/sh\nexit 0\n").expect("write binary");
        make_executable(&binary_path).expect("make executable");
        let _guard = PathEnvGuard::set(&bin_dir);

        let resolved = resolve_login_command(&gemini, &runtime_home).expect("resolve login");

        assert_eq!(resolved.command.program, binary_path.display().to_string());
        assert!(resolved
            .env
            .iter()
            .any(|(key, value)| key == "PATH" && value.contains(bin_dir.to_str().unwrap())));

        let _ = std::fs::remove_dir_all(runtime_home);
        let _ = std::fs::remove_dir_all(bin_dir);
    }

    #[test]
    fn resolve_login_command_errors_when_command_is_missing() {
        let _env_lock = env_lock();
        let mut gemini = descriptor_for_kind("gemini").expect("gemini descriptor");
        gemini.auth.login.as_mut().expect("login").command.program =
            format!("missing-gemini-{}", uuid::Uuid::new_v4());
        let runtime_home = make_temp_dir("anyharness-login-missing-test");
        let _guard = PathEnvGuard::clear();

        let error = resolve_login_command(&gemini, &runtime_home).expect_err("missing command");

        assert!(matches!(error, AgentRuntimeError::LoginCommandNotFound(kind) if kind == "gemini"));

        let _ = std::fs::remove_dir_all(runtime_home);
    }

    struct PathEnvGuard {
        original: Option<std::ffi::OsString>,
    }

    impl PathEnvGuard {
        fn set(path: &Path) -> Self {
            let original = std::env::var_os("PATH");
            std::env::set_var("PATH", path);
            Self { original }
        }

        fn clear() -> Self {
            let original = std::env::var_os("PATH");
            std::env::remove_var("PATH");
            Self { original }
        }
    }

    impl Drop for PathEnvGuard {
        fn drop(&mut self) {
            if let Some(original) = self.original.take() {
                std::env::set_var("PATH", original);
            } else {
                std::env::remove_var("PATH");
            }
        }
    }
}
