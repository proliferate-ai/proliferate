use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::artifacts::{
    resolve_agent_process_artifact, resolve_agent_process_fallback,
    resolve_agent_process_path_fallback, resolve_native_artifact,
};
use super::compatibility::detect_runtime_compatibility_issue;
use super::overrides::resolve_agent_process_override;
pub(crate) use super::paths::{
    artifact_root, has_managed_registry_binary_for_names, managed_registry_binary_for_names,
    managed_registry_npm_binary_for_names,
};
use super::status::compute_readiness;
use crate::domains::agents::credentials::{detect_credentials, detect_credentials_with_env};
use crate::domains::agents::model::*;

#[cfg(test)]
use super::artifacts::{
    found_artifact, managed_launcher_candidates, managed_npm_executable_relpath, not_found_artifact,
};
#[cfg(test)]
use super::compatibility::{claude_launch_requires_node, parse_node_version, NodeVersion};
#[cfg(test)]
use super::overrides::is_override_program_valid;

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
        resolve_agent_process_override(&descriptor.kind)
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

    let credential_state = if additional_env.is_empty() {
        detect_credentials(&descriptor.auth, &home_dir)
    } else {
        detect_credentials_with_env(&descriptor.auth, &home_dir, additional_env)
    };

    let status = compute_readiness(
        &native,
        &agent_process,
        &credential_state,
        &descriptor.auth,
        compatibility_issue.as_ref(),
    );

    ResolvedAgent {
        descriptor: descriptor.clone(),
        status,
        credential_state,
        native,
        agent_process,
        spawn,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

        assert_eq!(
            managed_registry_npm_binary_for_names(&runtime_home, &AgentKind::Gemini, &["gemini"]),
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
        let auth = AuthSpec {
            env_vars: vec!["OPENAI_API_KEY".into()],
            login: Some(LoginSpec {
                label: "Log in".into(),
                command: CommandSpec {
                    program: "codex".into(),
                    args: vec!["login".into()],
                },
                reuses_user_state: true,
                message: None,
            }),
            discovery: CredentialDiscoveryKind::Codex,
        };

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
        let auth = AuthSpec {
            env_vars: vec!["ANTHROPIC_API_KEY".into()],
            login: Some(LoginSpec {
                label: "Log in".into(),
                command: CommandSpec {
                    program: "claude".into(),
                    args: vec!["/login".into()],
                },
                reuses_user_state: true,
                message: None,
            }),
            discovery: CredentialDiscoveryKind::Claude,
        };

        let status = compute_readiness(
            &native,
            &agent_process,
            &CredentialState::LoginRequired,
            &auth,
            None,
        );

        assert_eq!(status, ResolvedAgentStatus::InstallRequired);
    }
}
