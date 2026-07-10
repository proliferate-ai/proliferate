//! Unit tests for `readiness::service` (agent resolution + launch-time
//! route-aware readiness). Split from `service.rs` to stay under the 600-line
//! source cap; `#[path]`-included from there.

use super::*;
use crate::domains::agents::auth::credentials::detect_credentials_with_env;
use crate::domains::agents::registry::built_in_registry;
use crate::integrations::agent_cli::executable::make_executable;

fn make_temp_dir(prefix: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).expect("create temp dir");
    path
}

struct PathEnvGuard {
    original: Option<std::ffi::OsString>,
}

impl PathEnvGuard {
    fn set(path: &Path) -> Self {
        let original = std::env::var_os("PATH");
        let paths = vec![path.to_path_buf()];
        let joined = std::env::join_paths(paths).expect("join PATH");
        std::env::set_var("PATH", joined);
        Self { original }
    }
}

impl Drop for PathEnvGuard {
    fn drop(&mut self) {
        if let Some(original) = &self.original {
            std::env::set_var("PATH", original);
        } else {
            std::env::remove_var("PATH");
        }
    }
}

struct EnvVarGuard {
    name: &'static str,
    original: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn set(name: &'static str, value: &Path) -> Self {
        let original = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, original }
    }

    fn set_str(name: &'static str, value: &str) -> Self {
        let original = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, original }
    }

    /// Remove a var for the guard's lifetime (restored on drop). Used to
    /// neutralize an ambient provider key so credential detection is
    /// deterministic regardless of the host's environment.
    fn remove(name: &'static str) -> Self {
        let original = std::env::var_os(name);
        std::env::remove_var(name);
        Self { name, original }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(original) = &self.original {
            std::env::set_var(self.name, original);
        } else {
            std::env::remove_var(self.name);
        }
    }
}

#[test]
fn parses_node_versions() {
    assert_eq!(
        parse_node_version("v20.9.0"),
        Some(NodeVersion {
            major: 20,
            minor: 9,
            patch: 0,
        })
    );
    assert_eq!(
        parse_node_version("20.10.1"),
        Some(NodeVersion {
            major: 20,
            minor: 10,
            patch: 1,
        })
    );
    assert_eq!(parse_node_version("garbage"), None);
}

#[test]
fn managed_launcher_candidates_include_managed_npm_binary() {
    let managed_dir = PathBuf::from("/tmp/claude");
    let candidates = managed_launcher_candidates(
        &managed_dir,
        &AgentKind::Claude,
        Some(Path::new("node_modules/.bin/claude-agent-acp")),
    );

    assert_eq!(
        candidates,
        vec![
            PathBuf::from("/tmp/claude/claude-launcher"),
            PathBuf::from("/tmp/claude/node_modules/.bin/claude-agent-acp"),
        ]
    );
}

#[test]
fn managed_npm_package_ref_mismatch_requires_reinstall() {
    let registry = built_in_registry();
    let claude = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Claude)
        .expect("missing Claude descriptor");
    let runtime_home = make_temp_dir("anyharness-claude-stale-managed-npm-test");
    let managed_dir = artifact_root(
        &runtime_home,
        &AgentKind::Claude,
        &ArtifactRole::AgentProcess,
    );
    let launcher_path = managed_dir.join("claude-launcher");
    std::fs::create_dir_all(launcher_path.parent().expect("launcher parent"))
        .expect("create launcher dir");
    std::fs::write(&launcher_path, "#!/bin/sh\nexit 0\n").expect("write launcher");
    make_executable(&launcher_path).expect("make launcher executable");
    std::fs::write(
        managed_dir.join("package.json"),
        r#"{"dependencies":{"@agentclientprotocol/claude-agent-acp":"github:proliferate-ai/claude-agent-acp#old-ref"}}"#,
    )
    .expect("write package metadata");

    let resolved = resolve_agent(&claude, &runtime_home);

    assert_eq!(resolved.status, ResolvedAgentStatus::InstallRequired);
    assert!(!resolved.agent_process.installed);
    assert!(resolved
        .agent_process
        .message
        .as_deref()
        .is_some_and(|message| message.contains("out of date")));

    let _ = std::fs::remove_dir_all(runtime_home);
}

#[test]
fn managed_registry_binary_for_names_finds_registry_binary() {
    let runtime_home = make_temp_dir("anyharness-registry-binary-test");
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

    assert_eq!(
        managed_registry_binary_for_names(&runtime_home, &AgentKind::Cursor, &["cursor-agent"]),
        Some(binary_path)
    );

    let _ = std::fs::remove_dir_all(runtime_home);
}

#[test]
fn managed_registry_npm_binary_for_names_finds_npm_bin() {
    let runtime_home = make_temp_dir("anyharness-registry-npm-binary-test");
    let binary_path = artifact_root(&runtime_home, &AgentKind::Grok, &ArtifactRole::AgentProcess)
        .join("registry_npm")
        .join("node_modules")
        .join(".bin")
        .join("grok");
    std::fs::create_dir_all(binary_path.parent().expect("binary parent"))
        .expect("create registry npm bin dir");
    std::fs::write(&binary_path, "#!/bin/sh\nexit 0\n").expect("write binary");
    make_executable(&binary_path).expect("make binary executable");

    assert_eq!(
        managed_registry_npm_binary_for_names(&runtime_home, &AgentKind::Grok, &["grok"]),
        Some(binary_path)
    );

    let _ = std::fs::remove_dir_all(runtime_home);
}

#[test]
fn registry_backed_binary_hint_launcher_requires_backing_binary() {
    let registry = built_in_registry();
    let cursor = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Cursor)
        .expect("missing Cursor descriptor");
    let runtime_home = make_temp_dir("anyharness-cursor-stale-launcher-test");
    let missing_binary = format!("missing-cursor-agent-{}", uuid::Uuid::new_v4());
    let launcher_path = artifact_root(
        &runtime_home,
        &AgentKind::Cursor,
        &ArtifactRole::AgentProcess,
    )
    .join("cursor-launcher");
    std::fs::create_dir_all(launcher_path.parent().expect("launcher parent"))
        .expect("create launcher dir");
    std::fs::write(
        &launcher_path,
        format!("#!/bin/sh\nset -e\nexec \"{missing_binary}\" acp \"$@\"\n"),
    )
    .expect("write launcher");
    make_executable(&launcher_path).expect("make launcher executable");
    let unrelated_registry_binary = artifact_root(
        &runtime_home,
        &AgentKind::Cursor,
        &ArtifactRole::AgentProcess,
    )
    .join("registry_binary")
    .join("node");
    std::fs::create_dir_all(unrelated_registry_binary.parent().expect("binary parent"))
        .expect("create registry binary dir");
    std::fs::write(&unrelated_registry_binary, "#!/bin/sh\nexit 0\n")
        .expect("write unrelated registry binary");
    make_executable(&unrelated_registry_binary).expect("make unrelated binary executable");

    let mut cursor = cursor;
    cursor.agent_process.install = AgentProcessInstallSpec::RegistryBacked {
        registry_id: "cursor".into(),
        fallback: AgentProcessFallback::BinaryHint {
            candidate_binaries: vec![missing_binary.clone()],
            args: vec!["acp".into()],
        },
    };

    let resolved = resolve_agent(&cursor, &runtime_home);

    assert_eq!(resolved.status, ResolvedAgentStatus::InstallRequired);
    assert!(!resolved.agent_process.installed);
    assert!(resolved
        .agent_process
        .message
        .as_deref()
        .is_some_and(|message| message.contains(&missing_binary)));

    let _ = std::fs::remove_dir_all(runtime_home);
}

#[test]
fn registry_backed_binary_hint_does_not_resolve_superset_wrapper_as_agent_process() {
    let registry = built_in_registry();
    let cursor = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Cursor)
        .expect("missing Cursor descriptor");
    let runtime_home = make_temp_dir("anyharness-cursor-wrapper-fallback-test");
    let path_dir = make_temp_dir("anyharness-cursor-wrapper-path-test");
    let wrapper_path = path_dir.join("cursor-agent");
    std::fs::write(
        &wrapper_path,
        "#!/bin/sh\n# Superset agent-wrapper v3\nexec cursor-agent \"$@\"\n",
    )
    .expect("write wrapper");
    make_executable(&wrapper_path).expect("make wrapper executable");
    let _path_guard = PathEnvGuard::set(&path_dir);
    let mut env = BTreeMap::new();
    env.insert("CURSOR_API_KEY".to_string(), "test-token".to_string());

    let resolved = resolve_agent_with_env(&cursor, &runtime_home, &env);

    assert_eq!(resolved.status, ResolvedAgentStatus::InstallRequired);
    assert!(!resolved.agent_process.installed);
    assert_eq!(resolved.agent_process.path, None);

    let _ = std::fs::remove_dir_all(runtime_home);
    let _ = std::fs::remove_dir_all(path_dir);
}

#[test]
fn claude_compatibility_check_applies_to_direct_managed_npm_installs() {
    let registry = built_in_registry();
    let claude = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Claude)
        .expect("missing Claude descriptor");

    assert!(managed_npm_executable_relpath(&claude.agent_process.install).is_some());
}

#[test]
fn override_program_validation_requires_existing_executable() {
    assert!(!is_override_program_valid(Path::new(
        "/definitely/missing/agent-binary"
    )));
    assert!(is_override_program_valid(Path::new("sh")));
}

#[test]
fn override_launch_prepends_catalog_default_args() {
    let registry = built_in_registry();
    let codex = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Codex)
        .expect("missing Codex descriptor");
    let runtime_home = make_temp_dir("anyharness-codex-override-default-args-test");
    let bin = runtime_home.join("codex-acp");
    std::fs::write(&bin, "#!/bin/sh\nexit 0\n").expect("write override binary");
    make_executable(&bin).expect("make override binary executable");

    let _program_guard = EnvVarGuard::set("ANYHARNESS_CODEX_AGENT_PROGRAM", &bin);
    let _args_guard =
        EnvVarGuard::set_str("ANYHARNESS_CODEX_AGENT_ARGS_JSON", r#"["--extra-dev-arg"]"#);

    let resolved = resolve_agent(&codex, &runtime_home);
    let spawn = resolved.spawn.expect("override spawn spec");

    assert!(spawn
        .args
        .windows(2)
        .any(|pair| pair == ["-c", "features.plugins=false"]));
    assert_eq!(
        spawn.args.last().map(String::as_str),
        Some("--extra-dev-arg")
    );

    let _ = std::fs::remove_dir_all(runtime_home);
}

#[test]
fn claude_node_compatibility_only_applies_when_launch_surface_uses_node() {
    let registry = built_in_registry();
    let claude = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Claude)
        .expect("missing Claude descriptor");

    assert!(claude_launch_requires_node(&claude, None));
    assert!(claude_launch_requires_node(
        &claude,
        Some(&SpawnSpec {
            program: PathBuf::from("/usr/bin/node"),
            args: vec![],
            env: std::collections::HashMap::new(),
            cwd: None,
        })
    ));
    assert!(!claude_launch_requires_node(
        &claude,
        Some(&SpawnSpec {
            program: PathBuf::from("/tmp/claude-agent-acp"),
            args: vec![],
            env: std::collections::HashMap::new(),
            cwd: None,
        })
    ));
}

#[test]
fn bundled_claude_descriptor_accepts_gateway_auth_token_env() {
    let registry = built_in_registry();
    let claude = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Claude)
        .expect("missing Claude descriptor");
    let mut env = BTreeMap::new();
    env.insert("ANTHROPIC_AUTH_TOKEN".to_string(), "token".to_string());

    assert_eq!(
        detect_credentials_with_env(&claude.auth, Path::new("/tmp/empty-home"), &env),
        CredentialState::Ready
    );
}

#[test]
fn env_ready_agents_do_not_require_native_cli_for_readiness() {
    let native = Some(not_found_artifact(
        ArtifactRole::NativeCli,
        Some("missing native".into()),
    ));
    let agent_process = found_artifact(
        ArtifactRole::AgentProcess,
        PathBuf::from("/tmp/codex-acp"),
        "override",
    );
    let auth = AuthSpec::test_single_required_slot(
        vec!["OPENAI_API_KEY".into()],
        Some(LoginSpec {
            label: "Log in".into(),
            command: CommandSpec {
                program: "codex".into(),
                args: vec!["login".into()],
            },
            reuses_user_state: true,
            message: None,
        }),
        CredentialDiscoveryKind::Codex,
    );

    let status = compute_readiness(
        &native,
        &agent_process,
        &CredentialState::Ready,
        &auth,
        None,
    );

    assert_eq!(status, ResolvedAgentStatus::Ready);
}

#[test]
fn missing_native_cli_blocks_login_required_agents_without_credentials() {
    let native = Some(not_found_artifact(
        ArtifactRole::NativeCli,
        Some("missing native".into()),
    ));
    let agent_process = found_artifact(
        ArtifactRole::AgentProcess,
        PathBuf::from("/tmp/claude-agent-acp"),
        "override",
    );
    let auth = AuthSpec::test_single_required_slot(
        vec!["ANTHROPIC_API_KEY".into()],
        Some(LoginSpec {
            label: "Log in".into(),
            command: CommandSpec {
                program: "claude".into(),
                args: vec!["/login".into()],
            },
            reuses_user_state: true,
            message: None,
        }),
        CredentialDiscoveryKind::Claude,
    );

    let status = compute_readiness(
        &native,
        &agent_process,
        &CredentialState::LoginRequired,
        &auth,
        None,
    );

    assert_eq!(status, ResolvedAgentStatus::InstallRequired);
}

#[test]
fn route_upgrade_clears_only_credential_gaps_never_install() {
    use ResolvedAgentStatus::*;
    // Credential/login gaps clear — the route injects the credential.
    assert_eq!(route_credentials_upgrade_status(CredentialsRequired), Ready);
    assert_eq!(route_credentials_upgrade_status(LoginRequired), Ready);
    // A missing binary (ACP agent process OR native CLI) is NEVER masked: a
    // route cannot conjure a binary, so InstallRequired stands.
    assert_eq!(
        route_credentials_upgrade_status(InstallRequired),
        InstallRequired
    );
    // Runtime incompatibility and already-terminal states pass through.
    assert_eq!(route_credentials_upgrade_status(Unsupported), Unsupported);
    assert_eq!(route_credentials_upgrade_status(Ready), Ready);
    assert_eq!(route_credentials_upgrade_status(Error), Error);
}

#[test]
fn resolve_launch_agent_matches_native_readiness_when_no_route_enrolled() {
    // With no agent-auth state file, launch readiness must be byte-for-byte
    // native readiness — the route path never changes a routeless agent.
    let registry = built_in_registry();
    let claude = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Claude)
        .expect("missing Claude descriptor");
    let runtime_home = make_temp_dir("anyharness-launch-agent-no-route");

    let native = resolve_agent_with_env(&claude, &runtime_home, &BTreeMap::new());
    let launch = resolve_launch_agent(&claude, &runtime_home, &BTreeMap::new());
    assert_eq!(
        launch.status, native.status,
        "an absent route must not change readiness"
    );
    assert_eq!(launch.credential_state, native.credential_state);

    let _ = std::fs::remove_dir_all(runtime_home);
}

#[test]
fn resolve_launch_agent_clears_a_gateway_routed_credential_gap() {
    // Issue #1106: a gateway route makes an agent whose ONLY gap is
    // credentials launch-ready with no credential in the workspace env (the
    // launcher injects it at spawn). Grok has no native artifact, so an
    // installed ACP process + absent XAI creds resolves to a CREDENTIAL gap
    // (LoginRequired), never InstallRequired — this exercises the credential
    // arm, not the install path.
    let registry = built_in_registry();
    let grok = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Grok)
        .expect("missing Grok descriptor");
    let runtime_home = make_temp_dir("anyharness-launch-agent-gateway-route");
    let bin = runtime_home.join("grok-acp");
    std::fs::write(&bin, "#!/bin/sh\nexit 0\n").expect("write override binary");
    make_executable(&bin).expect("make override binary executable");
    let _program_guard = EnvVarGuard::set("ANYHARNESS_GROK_AGENT_PROGRAM", &bin);
    // Neutralize the host's real credentials so the verdict is deterministic
    // everywhere: an empty HOME hides any local xai/grok auth, and the guards
    // clear any ambient key. Grok's required slot then has no credential ->
    // LoginRequired (grok has no native artifact, so this is a pure credential
    // gap, never an install gap).
    let empty_home = make_temp_dir("anyharness-launch-agent-empty-home");
    let _home_guard = EnvVarGuard::set("HOME", &empty_home);
    let _xai_guard = EnvVarGuard::remove("XAI_API_KEY");
    let _grok_guard = EnvVarGuard::remove("GROK_API_KEY");

    // Precondition: the ACP-process-installed, native-less, credential-less
    // agent is a credential gap (LoginRequired/CredentialsRequired), NOT
    // InstallRequired — so the upgrade below is the credential arm.
    let native = resolve_agent_with_env(&grok, &runtime_home, &BTreeMap::new());
    assert!(
        matches!(
            native.status,
            ResolvedAgentStatus::LoginRequired | ResolvedAgentStatus::CredentialsRequired
        ),
        "precondition: routeless grok should be a credential gap, got {:?}",
        native.status
    );

    // Enroll a gateway route for grok only → the credential gap clears.
    let state_dir = runtime_home.join("agent-auth");
    std::fs::create_dir_all(&state_dir).expect("create agent-auth dir");
    std::fs::write(
        state_dir.join("state.json"),
        r#"{"version":2,"revision":1,"harnesses":[{"harness_kind":"grok","sources":[{"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
    )
    .expect("write state");

    let launch = resolve_launch_agent(&grok, &runtime_home, &BTreeMap::new());
    assert_eq!(
        launch.status,
        ResolvedAgentStatus::Ready,
        "an enrolled gateway route must clear the credential gap (issue #1106)"
    );
    assert_eq!(launch.credential_state, CredentialState::ReadyViaLocalAuth);

    let _ = std::fs::remove_dir_all(runtime_home);
}

#[test]
fn resolve_launch_agent_never_masks_a_missing_binary() {
    // A route supplies credentials, not binaries. Claude on a clean home has
    // no ACP process / native CLI installed → InstallRequired, and an
    // enrolled gateway route must NOT flip that to Ready — the launcher still
    // has to exec a binary (Claude's ACP adapter shells out to the native
    // CLI via CLAUDE_CODE_EXECUTABLE).
    let registry = built_in_registry();
    let claude = registry
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Claude)
        .expect("missing Claude descriptor");
    let runtime_home = make_temp_dir("anyharness-launch-agent-missing-binary");
    let state_dir = runtime_home.join("agent-auth");
    std::fs::create_dir_all(&state_dir).expect("create agent-auth dir");
    std::fs::write(
        state_dir.join("state.json"),
        r#"{"version":2,"revision":1,"harnesses":[{"harness_kind":"claude","sources":[{"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
    )
    .expect("write state");

    let launch = resolve_launch_agent(&claude, &runtime_home, &BTreeMap::new());
    assert_eq!(
        launch.status,
        ResolvedAgentStatus::InstallRequired,
        "a route must not mask a missing agent binary as launchable"
    );

    let _ = std::fs::remove_dir_all(runtime_home);
}
