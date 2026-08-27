//! Login-command resolution: locate the executable an interactive `login`
//! should run (managed artifact, registry binary, or PATH) and the PATH env
//! the terminal needs. Serves auth; probes installs only through readiness's
//! public surface.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::domains::agents::installer::seed;
use crate::domains::agents::model::{AgentDescriptor, AgentKind, ArtifactRole};
use crate::domains::agents::readiness::paths::{
    artifact_root, managed_npm_binary_for_names, managed_registry_binary_for_names,
    managed_registry_npm_binary_for_names,
};
use crate::domains::agents::readiness::service::resolve_agent_unrouted;
use crate::integrations::agent_cli::executable::{find_in_path, is_valid_executable};

#[derive(Debug, thiserror::Error)]
pub enum AgentLoginError {
    #[error("Agent {0} does not support native login")]
    NotSupported(String),
    #[error("Login command for agent {0} was not found")]
    CommandNotFound(String),
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

pub fn resolve_login_command(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
) -> Result<ResolvedAgentLoginCommand, AgentLoginError> {
    let login = descriptor
        .auth
        .primary_login()
        .ok_or_else(|| AgentLoginError::NotSupported(descriptor.kind.as_str().into()))?;

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
            return Err(AgentLoginError::CommandNotFound(
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

fn managed_login_command(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
) -> Option<(AgentLoginCommand, Vec<PathBuf>)> {
    let login = descriptor.auth.primary_login()?;
    // Unrouted on purpose: this only needs the native artifact's path, and an
    // enrolled gateway/api_key route is irrelevant to "where is the vendor CLI
    // I am about to run `login` with". Reading the routed projection here would
    // load agent-auth state on every login-command build for no gain.
    let resolved = resolve_agent_unrouted(descriptor, runtime_home);
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

    // The managed npm tree's own vendor shim (`agent_process/node_modules/
    // .bin/<program>`). This is the rung grok's login lives on: its managed
    // artifact is the npm package `@xai-official/grok`, whose single binary is
    // both the ACP sidecar (`grok agent stdio`, what `grok-launcher` bakes)
    // and the interactive CLI (`grok login`). The launcher cannot serve login
    // — its args are fixed — so the shim beside it is what runs here. The
    // rung is deliberately NOT the launcher name (agent_auth delta row:
    // "teach login resolution the launcher name" would exec `grok agent
    // stdio login`).
    if let Some(path) = managed_npm_binary_for_names(
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

fn resolve_path_login_program(program: &str) -> Option<PathBuf> {
    let path = PathBuf::from(program);
    if path.components().count() > 1 {
        return is_valid_executable(&path).then_some(path);
    }
    find_in_path(program)
}

pub fn login_cwd(runtime_home: &Path) -> PathBuf {
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

pub fn display_command(command: &AgentLoginCommand) -> String {
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
    use crate::domains::agents::registry::built_in_registry;
    use crate::integrations::agent_cli::executable::make_executable;
    use std::sync::{Mutex, OnceLock};

    static ENV_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex")
    }

    fn descriptor_for_kind(kind: &str) -> AgentDescriptor {
        built_in_registry()
            .into_iter()
            .find(|descriptor| descriptor.kind.as_str() == kind)
            .expect("descriptor for kind")
    }

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn managed_login_command_uses_registry_binary_for_agent_process_installs() {
        let cursor = descriptor_for_kind("cursor");
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
    fn resolve_login_command_uses_managed_grok_registry_npm_without_path() {
        let _env_lock = env_lock();
        let grok = descriptor_for_kind("grok");
        let runtime_home = make_temp_dir("anyharness-login-managed-grok-npm-test");
        let binary_path =
            artifact_root(&runtime_home, &AgentKind::Grok, &ArtifactRole::AgentProcess)
                .join("registry_npm")
                .join("node_modules")
                .join(".bin")
                .join("grok");
        std::fs::create_dir_all(binary_path.parent().expect("binary parent"))
            .expect("create registry npm bin dir");
        std::fs::write(&binary_path, "#!/bin/sh\nexit 0\n").expect("write binary");
        make_executable(&binary_path).expect("make binary executable");
        let _guard = PathEnvGuard::clear();

        let resolved = resolve_login_command(&grok, &runtime_home).expect("resolve login");

        assert_eq!(resolved.command.program, binary_path.display().to_string());
        assert!(resolved.env.iter().any(|(key, value)| key == "PATH"
            && value.starts_with(binary_path.parent().unwrap().to_str().unwrap())));

        let _ = std::fs::remove_dir_all(runtime_home);
    }

    /// The grok login chain (agent_auth delta row): the managed install is
    /// `npm install --prefix agent_process @xai-official/grok`, which writes
    /// the vendor shim at `agent_process/node_modules/.bin/grok` beside the
    /// generated `grok-launcher`. With only the launcher and the shim on disk
    /// — no native artifact, no `registry_binary`, no legacy `registry_npm`
    /// tree, nothing on PATH — resolution must land on the shim, never on
    /// the launcher (whose baked `agent stdio` args make `login` impossible).
    #[test]
    fn resolve_login_command_finds_the_managed_npm_vendor_shim_not_the_launcher() {
        let _env_lock = env_lock();
        let grok = descriptor_for_kind("grok");
        let runtime_home = make_temp_dir("anyharness-login-managed-grok-shim-test");
        let managed_dir = artifact_root(&runtime_home, &AgentKind::Grok, &ArtifactRole::AgentProcess);
        let launcher_path = managed_dir.join("grok-launcher");
        let shim_path = managed_dir.join("node_modules").join(".bin").join("grok");
        std::fs::create_dir_all(shim_path.parent().expect("shim parent"))
            .expect("create managed npm bin dir");
        std::fs::write(&launcher_path, "#!/bin/sh\nexec grok agent stdio \"$@\"\n")
            .expect("write launcher");
        make_executable(&launcher_path).expect("make launcher executable");
        std::fs::write(&shim_path, "#!/bin/sh\nexit 0\n").expect("write shim");
        make_executable(&shim_path).expect("make shim executable");
        let _guard = PathEnvGuard::clear();

        let resolved = resolve_login_command(&grok, &runtime_home).expect("resolve login");

        assert_eq!(resolved.command.program, shim_path.display().to_string());
        assert_eq!(resolved.command.args, vec!["login".to_string()]);
        assert_ne!(resolved.command.program, launcher_path.display().to_string());
        assert!(resolved.env.iter().any(|(key, value)| key == "PATH"
            && value.starts_with(shim_path.parent().unwrap().to_str().unwrap())));

        let _ = std::fs::remove_dir_all(runtime_home);
    }

    #[test]
    fn resolve_login_command_uses_path_only_when_binary_exists() {
        let _env_lock = env_lock();
        let mut grok = descriptor_for_kind("grok");
        grok.auth.slots[0]
            .login
            .as_mut()
            .expect("login")
            .command
            .program = "anyharness-test-grok".into();
        let runtime_home = make_temp_dir("anyharness-login-path-test");
        let bin_dir = make_temp_dir("anyharness-login-path-bin-test");
        let binary_path = bin_dir.join("anyharness-test-grok");
        std::fs::write(&binary_path, "#!/bin/sh\nexit 0\n").expect("write binary");
        make_executable(&binary_path).expect("make executable");
        let _guard = PathEnvGuard::set(&bin_dir);

        let resolved = resolve_login_command(&grok, &runtime_home).expect("resolve login");

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
        let mut grok = descriptor_for_kind("grok");
        grok.auth.slots[0]
            .login
            .as_mut()
            .expect("login")
            .command
            .program = format!("missing-grok-{}", uuid::Uuid::new_v4());
        let runtime_home = make_temp_dir("anyharness-login-missing-test");
        let _guard = PathEnvGuard::clear();

        let error = resolve_login_command(&grok, &runtime_home).expect_err("missing command");

        assert!(matches!(error, AgentLoginError::CommandNotFound(kind) if kind == "grok"));

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
