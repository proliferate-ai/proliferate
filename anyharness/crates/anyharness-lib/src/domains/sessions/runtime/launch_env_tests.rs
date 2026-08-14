use std::path::PathBuf;

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
        credentials_from_route: false,
    }
}

#[test]
fn build_session_launch_env_sets_claude_code_executable_for_claude() {
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, Some("/tmp/managed/claude")),
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
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, Some("/tmp/managed/claude")),
        Some("opus[1m]"),
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

/// The catalog's `"default"` model row (`catalogs/agents/catalog.json`,
/// claude's `models[]`) is a sentinel meaning "use the harness's own
/// default", not a real model name — the claude CLI rejects
/// `ANTHROPIC_MODEL=default` with `model_not_found`. Launch env must omit the
/// var entirely so the CLI falls back to its own default.
#[test]
fn build_session_launch_env_omits_model_for_claude_default_sentinel() {
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, Some("/tmp/managed/claude")),
        Some("default"),
    )
    .expect("build env");

    assert!(
        !env.contains_key("ANTHROPIC_MODEL"),
        "sentinel \"default\" must not be forwarded as ANTHROPIC_MODEL, got {env:?}"
    );
}

#[test]
fn build_session_launch_env_sets_requested_model_for_real_claude_model_id() {
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, Some("/tmp/managed/claude")),
        Some("haiku"),
    )
    .expect("build env");

    assert_eq!(env.get("ANTHROPIC_MODEL").map(String::as_str), Some("haiku"));
}

#[test]
fn build_session_launch_env_ignores_claude_without_native_path() {
    let env = build_session_launch_env(&resolved_agent(AgentKind::Claude, None), None)
        .expect("build env");

    assert!(env.is_empty());
}

#[test]
fn build_session_launch_env_sets_requested_model_without_claude_native_path() {
    let env = build_session_launch_env(&resolved_agent(AgentKind::Claude, None), Some("sonnet"))
        .expect("build env");

    assert_eq!(
        env.get("ANTHROPIC_MODEL").map(String::as_str),
        Some("sonnet")
    );
    assert!(!env.contains_key("CLAUDE_CODE_EXECUTABLE"));
}

#[test]
fn build_session_launch_env_omits_model_for_blank_requested_model() {
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Claude, Some("/tmp/managed/claude")),
        Some("   "),
    )
    .expect("build env");

    assert!(!env.contains_key("ANTHROPIC_MODEL"));
}

/// Codex's isolated home is no longer built here — it is route-auth's native
/// recipe, rendered from the catalog. This layer must therefore contribute
/// NOTHING for codex, or it would write a second `CODEX_HOME` that competes with
/// the route layer's (the bug this replaces: the loser was silently shadowed, and
/// on a routed launch the shadowed home still held a copy of the user's
/// `auth.json`).
#[test]
fn build_session_launch_env_contributes_no_codex_home() {
    let env = build_session_launch_env(
        &resolved_agent(AgentKind::Codex, Some("/tmp/managed/codex")),
        Some("gpt-5.2"),
    )
    .expect("build env");

    assert!(
        env.is_empty(),
        "codex's home + config.toml belong to route_auth's recipe table, got {env:?}"
    );
}

/// The same for every remaining harness: this layer is claude-only now, so no
/// harness can pick up launch env from here by accident.
#[test]
fn build_session_launch_env_is_empty_for_every_non_claude_harness() {
    for kind in [
        AgentKind::Codex,
        AgentKind::OpenCode,
        AgentKind::Cursor,
        AgentKind::Grok,
    ] {
        let label = kind.as_str().to_string();
        let env = build_session_launch_env(
            &resolved_agent(kind, Some("/tmp/managed/agent")),
            Some("ignored"),
        )
        .expect("build env");
        assert!(env.is_empty(), "{label} should contribute nothing: {env:?}");
    }
}
