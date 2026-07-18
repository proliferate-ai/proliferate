use std::path::{Path, PathBuf};

use super::launch_env::build_session_launch_env;
use crate::domains::agents::model::{
    AgentKind, ArtifactRole, CredentialState, ResolvedAgent, ResolvedAgentStatus, ResolvedArtifact,
};
use crate::domains::agents::registry::built_in_registry;

fn resolved_agent(kind: AgentKind, native_path: Option<&str>) -> ResolvedAgent {
    let descriptor = built_in_registry()
        .into_iter()
        .find(|descriptor| descriptor.kind == kind)
        .expect("missing descriptor");

    ResolvedAgent {
        descriptor,
        status: ResolvedAgentStatus::Ready,
        credential_state: CredentialState::Ready,
        auth_slots: Vec::new(),
        cli_auth_state: None,
        native: native_path.map(|path| ResolvedArtifact {
            role: ArtifactRole::NativeCli,
            installed: true,
            source: Some("managed".into()),
            version: None,
            path: Some(PathBuf::from(path)),
            message: None,
        }),
        agent_process: ResolvedArtifact {
            role: ArtifactRole::AgentProcess,
            installed: true,
            source: Some("managed".into()),
            version: None,
            path: Some(PathBuf::from("/tmp/claude-agent-acp")),
            message: None,
        },
        spawn: None,
    }
}

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-session-runtime-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

struct EnvVarGuard {
    key: &'static str,
    previous: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn set(key: &'static str, value: &Path) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

#[test]
fn build_session_launch_env_sets_claude_code_executable_for_claude() {
    let runtime_home = TempDirGuard::new("claude-home");
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, Some("/tmp/managed/claude")),
        runtime_home.path(),
        None,
        None,
    )
    .expect("build env");

    assert_eq!(
        env.get("CLAUDE_CODE_EXECUTABLE").map(String::as_str),
        Some("/tmp/managed/claude")
    );
}

#[test]
fn build_session_launch_env_sets_requested_model_for_claude() {
    let runtime_home = TempDirGuard::new("claude-model-home");
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, Some("/tmp/managed/claude")),
        runtime_home.path(),
        Some("opus[1m]"),
        None,
    )
    .expect("build env");

    assert_eq!(
        env.get("ANTHROPIC_MODEL").map(String::as_str),
        Some("opus[1m]")
    );
    assert_eq!(
        env.get("CLAUDE_CODE_EXECUTABLE").map(String::as_str),
        Some("/tmp/managed/claude")
    );
}

#[test]
fn build_session_launch_env_ignores_claude_without_native_path() {
    let runtime_home = TempDirGuard::new("claude-missing-native-home");
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, None),
        runtime_home.path(),
        None,
        None,
    )
    .expect("build env");

    assert!(env.is_empty());
}

#[test]
fn build_session_launch_env_sets_requested_model_without_claude_native_path() {
    let runtime_home = TempDirGuard::new("claude-model-only-home");
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, None),
        runtime_home.path(),
        Some("sonnet"),
        None,
    )
    .expect("build env");

    assert_eq!(
        env.get("ANTHROPIC_MODEL").map(String::as_str),
        Some("sonnet")
    );
    assert!(!env.contains_key("CLAUDE_CODE_EXECUTABLE"));
}

#[test]
fn build_session_launch_env_sets_clean_codex_home_for_local_codex() {
    let runtime_home = TempDirGuard::new("codex-runtime");
    let source_codex_home = TempDirGuard::new("codex-source");
    std::fs::write(
        source_codex_home.path().join("auth.json"),
        r#"{"OPENAI_API_KEY":"sk-test"}"#,
    )
    .expect("write source auth");
    let _codex_home_guard = EnvVarGuard::set("CODEX_HOME", source_codex_home.path());

    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Codex, Some("/tmp/managed/codex")),
        runtime_home.path(),
        None,
        None,
    )
    .expect("build env");

    let codex_home = runtime_home.path().join("agent-auth").join("codex-local");
    assert_eq!(
        env.get("CODEX_HOME").map(String::as_str),
        Some(codex_home.to_string_lossy().as_ref())
    );
    let auth_json: serde_json::Value =
        serde_json::from_slice(&std::fs::read(codex_home.join("auth.json")).expect("read auth"))
            .expect("parse auth");
    assert_eq!(auth_json["OPENAI_API_KEY"], "sk-test");

    let config_toml = std::fs::read_to_string(codex_home.join("config.toml")).expect("read config");
    assert!(config_toml.contains(r#"model = "gpt-5.5""#));
    assert!(config_toml.contains(r#"model_reasoning_effort = "medium""#));
    assert!(config_toml.contains("plugins = false"));
    assert!(!codex_home.join("hooks.json").exists());
}

#[test]
fn build_session_launch_env_prefers_selected_codex_route_api_key() {
    let runtime_home = TempDirGuard::new("codex-route-runtime");
    let source_codex_home = TempDirGuard::new("codex-route-source");
    std::fs::write(
        source_codex_home.path().join("auth.json"),
        r#"{"OPENAI_API_KEY":"sk-ambient"}"#,
    )
    .expect("write source auth");
    let _codex_home_guard = EnvVarGuard::set("CODEX_HOME", source_codex_home.path());

    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Codex, Some("/tmp/managed/codex")),
        runtime_home.path(),
        None,
        Some("sk-selected"),
    )
    .expect("build env");

    let codex_home = env.get("CODEX_HOME").expect("CODEX_HOME");
    let auth_json: serde_json::Value = serde_json::from_slice(
        &std::fs::read(std::path::Path::new(codex_home).join("auth.json")).expect("read auth"),
    )
    .expect("parse auth");
    assert_eq!(auth_json["OPENAI_API_KEY"], "sk-selected");
}

#[test]
fn build_session_launch_env_ignores_other_agents() {
    let runtime_home = TempDirGuard::new("other-agent-runtime");
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Cursor, Some("/tmp/managed/cursor-agent")),
        runtime_home.path(),
        Some("ignored"),
        None,
    )
    .expect("build env");

    assert!(env.is_empty());
}
