use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::artifacts::{
    found_artifact, resolve_agent_process_artifact, resolve_agent_process_fallback,
    resolve_agent_process_path_fallback, resolve_native_artifact,
};
use super::compatibility::detect_runtime_compatibility_issue;
use super::overrides::resolve_agent_process_override;
use super::status::compute_readiness;
use crate::domains::agents::auth::credentials::{
    detect_auth_slots, detect_auth_slots_with_env, detect_cli_auth_state,
};
use crate::domains::agents::model::*;

#[cfg(test)]
use super::artifacts::{
    managed_launcher_candidates, managed_npm_executable_relpath, not_found_artifact,
};
#[cfg(test)]
use super::compatibility::{claude_launch_requires_node, parse_node_version, NodeVersion};
#[cfg(test)]
use super::overrides::is_override_program_valid;
#[cfg(test)]
use super::paths::{
    artifact_root, managed_registry_binary_for_names, managed_registry_npm_binary_for_names,
};

pub fn resolve_agent(descriptor: &AgentDescriptor, runtime_home: &Path) -> ResolvedAgent {
    resolve_agent_with_env(descriptor, runtime_home, &BTreeMap::new())
}

pub fn resolve_agent_with_env(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    additional_env: &BTreeMap<String, String>,
) -> ResolvedAgent {
    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));

    let native = descriptor
        .native
        .as_ref()
        .map(|spec| resolve_native_artifact(spec, &descriptor.kind, runtime_home));

    let mut spawn = None;
    let mut agent_process = if let Some((spawn_spec, override_artifact)) =
        resolve_agent_process_override(descriptor)
    {
        spawn = Some(spawn_spec);
        override_artifact
    } else {
        resolve_agent_process_artifact(&descriptor.agent_process, &descriptor.kind, runtime_home)
    };
    if spawn.is_none() {
        if let Some((fallback_artifact, fallback_spawn)) =
            resolve_agent_process_fallback(descriptor, native.as_ref(), &agent_process)
        {
            agent_process = fallback_artifact;
            spawn = fallback_spawn;
        } else if !agent_process.installed {
            if let Some(found) = resolve_agent_process_path_fallback(descriptor) {
                agent_process = found_artifact(ArtifactRole::AgentProcess, found, "path");
            }
        }
    }
    let compatibility_issue = detect_runtime_compatibility_issue(
        descriptor,
        &agent_process,
        spawn.as_ref(),
        runtime_home,
    );
    if let Some(message) = compatibility_issue.as_ref() {
        agent_process.message = Some(message.clone());
    }

    let (credential_state, auth_slots) = if additional_env.is_empty() {
        detect_auth_slots(&descriptor.auth, &home_dir)
    } else {
        detect_auth_slots_with_env(&descriptor.auth, &home_dir, additional_env)
    };

    let cli_auth_state = detect_cli_auth_state(&descriptor.auth, &home_dir);

    let status = compute_readiness(
        &native,
        &agent_process,
        &credential_state,
        &descriptor.auth,
        compatibility_issue.as_ref(),
    );

    let mut native = native;
    let mut agent_process = agent_process;
    super::versions::apply_manifest_versions(
        crate::domains::agents::installer::manifest::read_manifest(
            runtime_home,
            descriptor.kind.as_str(),
        )
        .as_ref(),
        &mut native,
        &mut agent_process,
    );

    ResolvedAgent {
        descriptor: descriptor.clone(),
        status,
        credential_state,
        auth_slots,
        cli_auth_state,
        native,
        agent_process,
        spawn,
    }
}

/// Launch-time readiness: [`resolve_agent_with_env`] PLUS the enrolled
/// agent-auth route state, so an enrolled gateway/api_key route makes the agent
/// credential-ready EXACTLY as the launcher will inject it at spawn.
///
/// This is the fix for issue #1106: the native readiness path only sees the
/// materialized workspace env, never `agent-auth/state.json`, so a gateway-route
/// session (whose credentials live in state.json and are injected only at
/// launch by `route_auth::resolve_launch_route_auth`) was reported
/// `LoginRequired`/`CredentialsRequired` and the session-create gate rejected
/// it — even though the launch path had valid credentials. Operators worked
/// around it by copying gateway credentials into a workspace env file, which in
/// turn corrupted auth-context classification (the raw `ANTHROPIC_AUTH_TOKEN`
/// activated the native `anthropic-api` context alongside `gateway`), unlocking
/// native-only models like `default` on what was really a gateway launch and
/// 400ing at LiteLLM.
///
/// Readiness and launch now consult ONE credential state. A route never masks a
/// missing agent process or a runtime incompatibility — the launcher still
/// needs the ACP binary and a compatible runtime — so only credential/login
/// gaps and the "native CLI missing" install gap are cleared (see
/// [`route_credentials_upgrade_status`]).
///
/// The launch paths (`create_session`, `ensure_live_session`/`start_live_session`,
/// and `resolved_workspace_launch_options`) use this. Native-readiness surfaces
/// (`GET /v1/agents`, login, reconcile, probe) keep using
/// [`resolve_agent`]/[`resolve_agent_with_env`]: they answer "is the vendor CLI
/// installed and logged in", which is a different question from "can the runtime
/// launch this agent through the enrolled route".
pub fn resolve_launch_agent(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    workspace_env: &BTreeMap<String, String>,
) -> ResolvedAgent {
    let mut resolved = resolve_agent_with_env(descriptor, runtime_home, workspace_env);
    let already_ready = matches!(
        resolved.credential_state,
        CredentialState::Ready | CredentialState::ReadyViaLocalAuth
    );
    if !already_ready
        && crate::domains::agents::route_auth::launch_route_provides_credentials(
            runtime_home,
            descriptor.kind.as_str(),
        )
    {
        let upgraded =
            route_credentials_upgrade_status(resolved.status, resolved.agent_process.installed);
        if upgraded == ResolvedAgentStatus::Ready {
            // The route supplies credentials the launcher injects at spawn.
            // `ReadyViaLocalAuth` is the closest existing state: ready via a
            // non-env, runtime-materialized credential rather than a workspace
            // env var.
            resolved.credential_state = CredentialState::ReadyViaLocalAuth;
        }
        resolved.status = upgraded;
    }
    resolved
}

/// Given a native-readiness verdict for an agent whose enrolled route supplies
/// launch credentials, decide the launch-time status. A route clears the
/// credential/login gaps (`CredentialsRequired`, `LoginRequired`) and the
/// "native CLI missing" install gap (`InstallRequired` while the ACP agent
/// process IS installed — a gateway launch does not need the vendor CLI login).
/// It NEVER clears a missing agent process (`InstallRequired` with the process
/// absent) or a runtime incompatibility (`Unsupported`): the launcher still
/// needs the ACP binary and a compatible runtime. `Ready`/`Error` pass through.
fn route_credentials_upgrade_status(
    status: ResolvedAgentStatus,
    agent_process_installed: bool,
) -> ResolvedAgentStatus {
    match status {
        ResolvedAgentStatus::CredentialsRequired | ResolvedAgentStatus::LoginRequired => {
            ResolvedAgentStatus::Ready
        }
        ResolvedAgentStatus::InstallRequired if agent_process_installed => {
            ResolvedAgentStatus::Ready
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
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
    fn route_upgrade_clears_credential_and_native_install_gaps_only() {
        use ResolvedAgentStatus::*;
        // Credential/login gaps clear — the route injects the credential.
        assert_eq!(route_credentials_upgrade_status(CredentialsRequired, true), Ready);
        assert_eq!(route_credentials_upgrade_status(LoginRequired, true), Ready);
        // Native CLI missing but the ACP agent process IS installed → Ready: a
        // gateway launch needs no vendor CLI login.
        assert_eq!(route_credentials_upgrade_status(InstallRequired, true), Ready);
        // Agent process itself missing → still InstallRequired: a route cannot
        // supply the ACP binary the launcher must exec.
        assert_eq!(
            route_credentials_upgrade_status(InstallRequired, false),
            InstallRequired
        );
        // Runtime incompatibility and already-terminal states pass through.
        assert_eq!(route_credentials_upgrade_status(Unsupported, true), Unsupported);
        assert_eq!(route_credentials_upgrade_status(Ready, true), Ready);
        assert_eq!(route_credentials_upgrade_status(Error, false), Error);
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
    fn resolve_launch_agent_readies_a_gateway_routed_agent() {
        // Issue #1106: a gateway route makes the agent launch-ready without any
        // credential in the workspace env (the launcher injects it at spawn).
        // The codex agent-process override gives an installed ACP process so the
        // test isolates the credential dimension from install/compat.
        let registry = built_in_registry();
        let codex = registry
            .into_iter()
            .find(|descriptor| descriptor.kind == AgentKind::Codex)
            .expect("missing Codex descriptor");
        let runtime_home = make_temp_dir("anyharness-launch-agent-gateway-route");
        let bin = runtime_home.join("codex-acp");
        std::fs::write(&bin, "#!/bin/sh\nexit 0\n").expect("write override binary");
        make_executable(&bin).expect("make override binary executable");
        let _program_guard = EnvVarGuard::set("ANYHARNESS_CODEX_AGENT_PROGRAM", &bin);

        // Enroll a gateway route for codex only.
        let state_dir = runtime_home.join("agent-auth");
        std::fs::create_dir_all(&state_dir).expect("create agent-auth dir");
        std::fs::write(
            state_dir.join("state.json"),
            r#"{"version":2,"revision":1,"harnesses":[{"harness_kind":"codex","sources":[{"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
        )
        .expect("write state");

        let launch = resolve_launch_agent(&codex, &runtime_home, &BTreeMap::new());
        assert_eq!(
            launch.status,
            ResolvedAgentStatus::Ready,
            "an enrolled gateway route must make the agent launch-ready (issue #1106)"
        );

        // The route is scoped to codex: claude (no route, agent process not
        // installed on this clean home) is not made ready by codex's route.
        let claude = built_in_registry()
            .into_iter()
            .find(|descriptor| descriptor.kind == AgentKind::Claude)
            .expect("missing Claude descriptor");
        let claude_launch = resolve_launch_agent(&claude, &runtime_home, &BTreeMap::new());
        assert_ne!(
            claude_launch.status,
            ResolvedAgentStatus::Ready,
            "a codex-only route must not make claude launch-ready"
        );

        let _ = std::fs::remove_dir_all(runtime_home);
    }
}
