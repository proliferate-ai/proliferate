use std::path::{Path, PathBuf};
use std::process::Command;

use super::credentials::detect_credentials;
use super::installer::is_valid_executable;
use super::model::*;
use super::seed;

pub fn resolve_agent(descriptor: &AgentDescriptor, runtime_home: &Path) -> ResolvedAgent {
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
            if let Some(found) = find_in_path(&descriptor.launch.executable_name) {
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

    let credential_state = detect_credentials(&descriptor.auth, &home_dir);

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

// ---------------------------------------------------------------------------
// Native artifact resolution
// ---------------------------------------------------------------------------

fn resolve_native_artifact(
    spec: &NativeArtifactSpec,
    kind: &AgentKind,
    runtime_home: &Path,
) -> ResolvedArtifact {
    let managed_dir = artifact_root(runtime_home, kind, &ArtifactRole::NativeCli);

    match &spec.install {
        NativeInstallSpec::DirectBinary { .. } | NativeInstallSpec::TarballRelease { .. } => {
            let managed_path = managed_dir.join(kind.as_str());
            if is_valid_executable(&managed_path) {
                return found_artifact(ArtifactRole::NativeCli, managed_path, "managed");
            }
            if let Some(found) = find_in_path(kind.as_str()) {
                return found_artifact(ArtifactRole::NativeCli, found, "path");
            }
            not_found_artifact(
                ArtifactRole::NativeCli,
                Some(format!(
                    "Not installed. Use the install endpoint to download the {} CLI.",
                    kind.display_name()
                )),
            )
        }
        NativeInstallSpec::PathOnly {
            candidate_binaries,
            docs_url,
        } => resolve_path_only(
            ArtifactRole::NativeCli,
            candidate_binaries,
            docs_url.as_deref(),
        ),
        NativeInstallSpec::Manual { docs_url } => ResolvedArtifact {
            role: ArtifactRole::NativeCli,
            installed: false,
            source: None,
            version: None,
            path: None,
            message: Some(format!("Manual install required. See: {docs_url}")),
        },
    }
}

// ---------------------------------------------------------------------------
// Agent-process artifact resolution
// ---------------------------------------------------------------------------

fn resolve_agent_process_artifact(
    spec: &AgentProcessArtifactSpec,
    kind: &AgentKind,
    runtime_home: &Path,
) -> ResolvedArtifact {
    let managed_dir = artifact_root(runtime_home, kind, &ArtifactRole::AgentProcess);

    match &spec.install {
        AgentProcessInstallSpec::RegistryBacked { .. } => {
            let managed_candidates = managed_launcher_candidates(
                &managed_dir,
                kind,
                managed_npm_executable_relpath(&spec.install),
            );
            for path in &managed_candidates {
                if path.exists() {
                    return found_artifact(ArtifactRole::AgentProcess, path.clone(), "managed");
                }
            }
            not_found_artifact(
                ArtifactRole::AgentProcess,
                Some("Not installed. Use the install endpoint to set up.".into()),
            )
        }
        AgentProcessInstallSpec::ManagedNpmPackage {
            executable_relpath, ..
        } => {
            let managed_candidates =
                managed_launcher_candidates(&managed_dir, kind, Some(executable_relpath.as_path()));
            for path in &managed_candidates {
                if path.exists() {
                    return found_artifact(ArtifactRole::AgentProcess, path.clone(), "managed");
                }
            }
            if let Some(binary_name) = executable_relpath
                .file_name()
                .and_then(|name| name.to_str())
            {
                if let Some(found) = find_in_path(binary_name) {
                    return found_artifact(ArtifactRole::AgentProcess, found, "path");
                }
            }

            not_found_artifact(
                ArtifactRole::AgentProcess,
                Some("Not installed. Use the install endpoint to set up.".into()),
            )
        }
        AgentProcessInstallSpec::PathOnly {
            candidate_binaries,
            docs_url,
            ..
        } => resolve_path_only(
            ArtifactRole::AgentProcess,
            candidate_binaries,
            docs_url.as_deref(),
        ),
        AgentProcessInstallSpec::Manual { docs_url } => ResolvedArtifact {
            role: ArtifactRole::AgentProcess,
            installed: false,
            source: None,
            version: None,
            path: None,
            message: Some(format!("Manual install required. See: {docs_url}")),
        },
    }
}

fn managed_launcher_candidates(
    managed_dir: &Path,
    kind: &AgentKind,
    executable_relpath: Option<&Path>,
) -> Vec<PathBuf> {
    let mut paths = vec![];
    paths.push(managed_dir.join(format!("{}-launcher", kind.as_str())));

    if let Some(executable_relpath) = executable_relpath {
        paths.push(managed_dir.join(executable_relpath));
    }
    paths
}

fn managed_npm_executable_relpath(spec: &AgentProcessInstallSpec) -> Option<&Path> {
    match spec {
        AgentProcessInstallSpec::RegistryBacked {
            fallback:
                AgentProcessFallback::NpmPackage {
                    executable_relpath, ..
                },
            ..
        }
        | AgentProcessInstallSpec::ManagedNpmPackage {
            executable_relpath, ..
        } => Some(executable_relpath.as_path()),
        AgentProcessInstallSpec::RegistryBacked { .. }
        | AgentProcessInstallSpec::PathOnly { .. }
        | AgentProcessInstallSpec::Manual { .. } => None,
    }
}

fn resolve_agent_process_fallback(
    descriptor: &AgentDescriptor,
    native: Option<&ResolvedArtifact>,
    current: &ResolvedArtifact,
) -> Option<(ResolvedArtifact, Option<SpawnSpec>)> {
    if current.installed {
        return None;
    }

    let AgentProcessInstallSpec::RegistryBacked { fallback, .. } =
        &descriptor.agent_process.install
    else {
        return None;
    };

    match fallback {
        AgentProcessFallback::BinaryHint {
            candidate_binaries,
            args,
        } => {
            for binary in candidate_binaries {
                if let Some(found) = find_in_path(binary) {
                    return Some((
                        found_artifact(ArtifactRole::AgentProcess, found.clone(), "path"),
                        Some(SpawnSpec {
                            program: found,
                            args: args.clone(),
                            env: std::collections::HashMap::new(),
                            cwd: None,
                        }),
                    ));
                }
            }
            None
        }
        AgentProcessFallback::NativeSubcommand { args } => {
            let native = native?;
            let native_path = native.path.clone()?;
            Some((
                found_artifact(ArtifactRole::AgentProcess, native_path.clone(), "native"),
                Some(SpawnSpec {
                    program: native_path,
                    args: args.clone(),
                    env: std::collections::HashMap::new(),
                    cwd: None,
                }),
            ))
        }
        AgentProcessFallback::NpmPackage {
            executable_relpath, ..
        } => {
            let binary_name = executable_relpath.file_name()?.to_str()?;
            find_in_path(binary_name).map(|found| {
                (
                    found_artifact(ArtifactRole::AgentProcess, found, "path"),
                    None,
                )
            })
        }
    }
}

fn resolve_agent_process_override(kind: &AgentKind) -> Option<(SpawnSpec, ResolvedArtifact)> {
    let prefix = agent_override_prefix(kind);
    let program = std::env::var(format!("{prefix}_AGENT_PROGRAM")).ok()?;
    let program = program.trim();
    if program.is_empty() {
        return None;
    }

    let requested_program = PathBuf::from(program);
    let resolved_program =
        resolve_override_program(&requested_program).unwrap_or_else(|| requested_program.clone());
    let message = if resolved_program == requested_program
        && !is_override_program_valid(&requested_program)
    {
        Some(format!(
            "Override executable `{}` was not found or is not executable.",
            requested_program.display()
        ))
    } else {
        None
    };

    Some((
        SpawnSpec {
            program: resolved_program.clone(),
            args: load_json_env_vec(&format!("{prefix}_AGENT_ARGS_JSON")),
            env: load_json_env_map(&format!("{prefix}_AGENT_ENV_JSON")),
            cwd: std::env::var(format!("{prefix}_AGENT_CWD"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .map(PathBuf::from),
        },
        ResolvedArtifact {
            role: ArtifactRole::AgentProcess,
            installed: message.is_none(),
            source: Some("override".into()),
            version: None,
            path: Some(resolved_program),
            message,
        },
    ))
}

fn resolve_override_program(program: &Path) -> Option<PathBuf> {
    if looks_like_path(program) {
        return is_valid_executable(program).then(|| program.to_path_buf());
    }

    let binary_name = program.to_str()?;
    find_in_path(binary_name)
}

fn looks_like_path(program: &Path) -> bool {
    program.is_absolute() || program.components().count() > 1
}

fn is_override_program_valid(program: &Path) -> bool {
    if looks_like_path(program) {
        return is_valid_executable(program);
    }

    program.to_str().and_then(find_in_path).is_some()
}

fn agent_override_prefix(kind: &AgentKind) -> String {
    format!("ANYHARNESS_{}", kind.as_str().to_ascii_uppercase())
}

fn load_json_env_vec(name: &str) -> Vec<String> {
    let Some(raw) = std::env::var(name).ok() else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_else(|error| {
        tracing::warn!(env_var = name, %error, "invalid JSON array override");
        Vec::new()
    })
}

fn load_json_env_map(name: &str) -> std::collections::HashMap<String, String> {
    let Some(raw) = std::env::var(name).ok() else {
        return std::collections::HashMap::new();
    };
    serde_json::from_str::<std::collections::HashMap<String, String>>(&raw).unwrap_or_else(
        |error| {
            tracing::warn!(env_var = name, %error, "invalid JSON object override");
            std::collections::HashMap::new()
        },
    )
}

// ---------------------------------------------------------------------------
// Readiness computation
// ---------------------------------------------------------------------------

fn compute_readiness(
    native: &Option<ResolvedArtifact>,
    agent_process: &ResolvedArtifact,
    credential_state: &CredentialState,
    auth: &AuthSpec,
    compatibility_issue: Option<&String>,
) -> ResolvedAgentStatus {
    if !agent_process.installed {
        return ResolvedAgentStatus::InstallRequired;
    }

    if compatibility_issue.is_some() {
        return ResolvedAgentStatus::Unsupported;
    }

    match credential_state {
        CredentialState::Ready | CredentialState::ReadyViaLocalAuth => ResolvedAgentStatus::Ready,
        _ if native
            .as_ref()
            .is_some_and(|native_artifact| !native_artifact.installed) =>
        {
            ResolvedAgentStatus::InstallRequired
        }
        CredentialState::MissingEnv => ResolvedAgentStatus::CredentialsRequired,
        CredentialState::LoginRequired => {
            if auth.login.is_some() {
                ResolvedAgentStatus::LoginRequired
            } else {
                ResolvedAgentStatus::CredentialsRequired
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn resolve_path_only(
    role: ArtifactRole,
    candidate_binaries: &[String],
    docs_url: Option<&str>,
) -> ResolvedArtifact {
    for bin in candidate_binaries {
        if let Some(found) = find_in_path(bin) {
            return found_artifact(role, found, "path");
        }
    }
    not_found_artifact(
        role,
        Some(
            docs_url
                .map(|u| format!("Not found on PATH. See: {u}"))
                .unwrap_or_else(|| "Not found on PATH.".into()),
        ),
    )
}

fn found_artifact(role: ArtifactRole, path: PathBuf, source: &str) -> ResolvedArtifact {
    ResolvedArtifact {
        role,
        installed: true,
        source: Some(source.into()),
        version: None,
        path: Some(path),
        message: None,
    }
}

fn not_found_artifact(role: ArtifactRole, message: Option<String>) -> ResolvedArtifact {
    ResolvedArtifact {
        role,
        installed: false,
        source: None,
        version: None,
        path: None,
        message,
    }
}

fn find_in_path(binary_name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(binary_name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

pub(crate) fn artifact_root(runtime_home: &Path, kind: &AgentKind, role: &ArtifactRole) -> PathBuf {
    runtime_home
        .join("agents")
        .join(kind.as_str())
        .join(match role {
            ArtifactRole::NativeCli => "native",
            ArtifactRole::AgentProcess => "agent_process",
        })
}

fn detect_runtime_compatibility_issue(
    descriptor: &AgentDescriptor,
    agent_process: &ResolvedArtifact,
    spawn: Option<&SpawnSpec>,
    runtime_home: &Path,
) -> Option<String> {
    if !agent_process.installed {
        return None;
    }

    if descriptor.kind != AgentKind::Claude {
        return None;
    }

    if !claude_launch_requires_node(descriptor, spawn) {
        return None;
    }

    let node_path = seed::bundled_node_bin(runtime_home)
        .or_else(|| find_in_path("node"))
        .or_else(|| find_in_path("node.exe"));
    let Some(node_path) = node_path else {
        return Some(
            "Claude ACP requires Node.js 20.10+, but neither bundled Node nor `node` on PATH was found. Upgrade the sandbox template or install a newer Node runtime."
                .into(),
        );
    };

    let output = Command::new(&node_path).arg("--version").output();
    let output = match output {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Some(format!(
                "Claude ACP requires Node.js 20.10+, but `{} --version` failed{}.",
                node_path.display(),
                if stderr.is_empty() {
                    String::new()
                } else {
                    format!(": {stderr}")
                }
            ));
        }
        Err(error) => {
            return Some(format!(
                "Claude ACP requires Node.js 20.10+, but `{} --version` could not run: {error}.",
                node_path.display()
            ));
        }
    };

    let raw_version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let Some(version) = parse_node_version(&raw_version) else {
        return Some(format!(
            "Claude ACP requires Node.js 20.10+, but the runtime reported an unrecognized Node version `{raw_version}`."
        ));
    };

    let min_version = NodeVersion {
        major: 20,
        minor: 10,
        patch: 0,
    };
    if version >= min_version {
        return None;
    }

    let launch_target = spawn
        .map(|spec| spec.program.display().to_string())
        .unwrap_or_else(|| {
            artifact_root(runtime_home, &descriptor.kind, &ArtifactRole::AgentProcess)
                .join("claude-launcher")
                .display()
                .to_string()
        });
    Some(format!(
        "Claude ACP requires Node.js 20.10+, but found Node.js {raw_version}. The launch target `{launch_target}` will crash before ACP initialize. Upgrade the sandbox template image or install a newer Node runtime."
    ))
}

fn claude_launch_requires_node(descriptor: &AgentDescriptor, spawn: Option<&SpawnSpec>) -> bool {
    if descriptor.kind != AgentKind::Claude {
        return false;
    }

    if let Some(spawn) = spawn {
        return spawn
            .program
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| matches!(name, "node" | "node.exe"));
    }

    managed_npm_executable_relpath(&descriptor.agent_process.install).is_some()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct NodeVersion {
    major: u32,
    minor: u32,
    patch: u32,
}

fn parse_node_version(raw: &str) -> Option<NodeVersion> {
    let mut parts = raw.trim().trim_start_matches('v').split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    Some(NodeVersion {
        major,
        minor,
        patch,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::registry::built_in_registry;

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
