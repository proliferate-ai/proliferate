use super::model::*;
use std::path::PathBuf;

const CLAUDE_AGENT_ACP_PACKAGE: &str =
    "git+https://github.com/proliferate-ai/claude-agent-acp.git#906204b3cd798180df75502783a587bad19614ec";
const CLAUDE_AGENT_ACP_DOCS_URL: &str = "https://github.com/proliferate-ai/claude-agent-acp";
const CODEX_AGENT_ACP_PACKAGE: &str = "@proliferateai/codex-acp@0.11.8";
const CODEX_AGENT_ACP_DOCS_URL: &str = "https://github.com/proliferate-ai/codex-acp";

/// Returns the built-in registry of supported agent descriptors for v1.
/// OpenClaw is intentionally excluded from v1 scope.
pub fn built_in_registry() -> Vec<AgentDescriptor> {
    vec![
        claude_descriptor(),
        codex_descriptor(),
        gemini_descriptor(),
        cursor_descriptor(),
        opencode_descriptor(),
        amp_descriptor(),
    ]
}

fn claude_descriptor() -> AgentDescriptor {
    AgentDescriptor {
        kind: AgentKind::Claude,
        native: Some(NativeArtifactSpec {
            install: NativeInstallSpec::DirectBinary {
                latest_version_url: Some(
                    "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest".into(),
                ),
                binary_url_template:
                    "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/{version}/{platform}/claude".into(),
                platform_map: vec![
                    (Platform::MacosArm64, "darwin-arm64".into()),
                    (Platform::MacosX64, "darwin-x64".into()),
                    (Platform::LinuxX64, "linux-x64".into()),
                    (Platform::LinuxArm64, "linux-arm64".into()),
                    (Platform::WindowsX64, "win32-x64".into()),
                    (Platform::WindowsArm64, "win32-arm64".into()),
                ],
            },
        }),
        agent_process: AgentProcessArtifactSpec {
            install: AgentProcessInstallSpec::ManagedNpmPackage {
                package: CLAUDE_AGENT_ACP_PACKAGE.into(),
                package_subdir: None,
                source_build_binary_name: None,
                executable_relpath: PathBuf::from("node_modules/.bin/claude-agent-acp"),
            },
        },
        launch: LaunchSpecTemplate {
            executable_name: "claude-agent-acp".into(),
            default_args: vec![],
        },
        auth: AuthSpec {
            env_vars: vec!["ANTHROPIC_API_KEY".into()],
            login: Some(LoginSpec {
                label: "Log in with Claude".into(),
                command: CommandSpec {
                    program: "claude".into(),
                    args: vec!["/login".into()],
                },
                reuses_user_state: true,
                message: None,
            }),
            discovery: CredentialDiscoveryKind::Claude,
        },
        docs_url: Some(CLAUDE_AGENT_ACP_DOCS_URL.into()),
    }
}

fn codex_descriptor() -> AgentDescriptor {
    AgentDescriptor {
        kind: AgentKind::Codex,
        native: Some(NativeArtifactSpec {
            install: NativeInstallSpec::TarballRelease {
                latest_url_template:
                    "https://github.com/openai/codex/releases/latest/download/codex-{target}.tar.gz".into(),
                versioned_url_template:
                    "https://github.com/openai/codex/releases/download/{version}/codex-{target}.tar.gz".into(),
                expected_binary_template: "codex-{target}".into(),
                platform_map: vec![
                    (Platform::MacosArm64, "aarch64-apple-darwin".into()),
                    (Platform::MacosX64, "x86_64-apple-darwin".into()),
                    (Platform::LinuxX64, "x86_64-unknown-linux-musl".into()),
                    (Platform::LinuxArm64, "aarch64-unknown-linux-musl".into()),
                    (Platform::WindowsX64, "x86_64-pc-windows-msvc".into()),
                    (Platform::WindowsArm64, "aarch64-pc-windows-msvc".into()),
                ],
            },
        }),
        agent_process: AgentProcessArtifactSpec {
            install: AgentProcessInstallSpec::ManagedNpmPackage {
                package: CODEX_AGENT_ACP_PACKAGE.into(),
                package_subdir: None,
                source_build_binary_name: None,
                executable_relpath: PathBuf::from("node_modules/.bin/codex-acp"),
            },
        },
        launch: LaunchSpecTemplate {
            executable_name: "codex-acp".into(),
            default_args: vec![],
        },
        auth: AuthSpec {
            env_vars: vec!["OPENAI_API_KEY".into(), "CODEX_API_KEY".into()],
            login: Some(LoginSpec {
                label: "Log in with Codex".into(),
                command: CommandSpec {
                    program: "codex".into(),
                    args: vec!["login".into()],
                },
                reuses_user_state: true,
                message: None,
            }),
            discovery: CredentialDiscoveryKind::Codex,
        },
        docs_url: Some(CODEX_AGENT_ACP_DOCS_URL.into()),
    }
}

fn gemini_descriptor() -> AgentDescriptor {
    AgentDescriptor {
        kind: AgentKind::Gemini,
        native: None,
        agent_process: AgentProcessArtifactSpec {
            install: AgentProcessInstallSpec::RegistryBacked {
                registry_id: "gemini".into(),
                fallback: AgentProcessFallback::BinaryHint {
                    candidate_binaries: vec!["gemini".into()],
                    args: vec!["--experimental-acp".into()],
                },
            },
        },
        launch: LaunchSpecTemplate {
            executable_name: "gemini".into(),
            default_args: vec![],
        },
        auth: AuthSpec {
            env_vars: vec!["GEMINI_API_KEY".into(), "GOOGLE_API_KEY".into()],
            login: Some(LoginSpec {
                label: "Log in with Gemini".into(),
                command: CommandSpec {
                    program: "gemini".into(),
                    args: vec![],
                },
                reuses_user_state: true,
                message: Some(
                    "Run Gemini in a terminal, then choose Sign in with Google. If Gemini opens directly into chat, run /auth to switch authentication."
                        .into(),
                ),
            }),
            discovery: CredentialDiscoveryKind::Gemini,
        },
        docs_url: Some("https://github.com/google-gemini/gemini-cli".into()),
    }
}

fn cursor_descriptor() -> AgentDescriptor {
    AgentDescriptor {
        kind: AgentKind::Cursor,
        native: None,
        agent_process: AgentProcessArtifactSpec {
            install: AgentProcessInstallSpec::RegistryBacked {
                registry_id: "cursor-acp".into(),
                fallback: AgentProcessFallback::BinaryHint {
                    candidate_binaries: vec!["cursor-agent".into()],
                    args: vec!["acp".into()],
                },
            },
        },
        launch: LaunchSpecTemplate {
            executable_name: "cursor-agent".into(),
            default_args: vec![],
        },
        auth: AuthSpec {
            env_vars: vec!["CURSOR_API_KEY".into()],
            login: Some(LoginSpec {
                label: "Log in with Cursor".into(),
                command: CommandSpec {
                    program: "cursor-agent".into(),
                    args: vec!["login".into()],
                },
                reuses_user_state: true,
                message: None,
            }),
            discovery: CredentialDiscoveryKind::Cursor,
        },
        docs_url: Some("https://docs.cursor.com/cli/acp".into()),
    }
}

fn amp_descriptor() -> AgentDescriptor {
    AgentDescriptor {
        kind: AgentKind::Amp,
        native: Some(NativeArtifactSpec {
            install: NativeInstallSpec::DirectBinary {
                latest_version_url: Some(
                    "https://storage.googleapis.com/amp-public-assets-prod-0/cli/cli-version.txt"
                        .into(),
                ),
                binary_url_template:
                    "https://storage.googleapis.com/amp-public-assets-prod-0/cli/{version}/amp-{platform}"
                        .into(),
                platform_map: vec![
                    (Platform::MacosArm64, "darwin-arm64".into()),
                    (Platform::MacosX64, "darwin-x64".into()),
                    (Platform::LinuxX64, "linux-x64".into()),
                    (Platform::LinuxArm64, "linux-arm64".into()),
                    (Platform::WindowsX64, "win32-x64".into()),
                    (Platform::WindowsArm64, "win32-arm64".into()),
                ],
            },
        }),
        agent_process: AgentProcessArtifactSpec {
            install: AgentProcessInstallSpec::RegistryBacked {
                registry_id: "amp-acp".into(),
                fallback: AgentProcessFallback::NpmPackage {
                    package: "amp-acp".into(),
                    package_subdir: None,
                    source_build_binary_name: None,
                    executable_relpath: PathBuf::from("node_modules/.bin/amp-acp"),
                },
            },
        },
        launch: LaunchSpecTemplate {
            executable_name: "amp-acp".into(),
            default_args: vec![],
        },
        auth: AuthSpec {
            env_vars: vec!["AMP_API_KEY".into()],
            login: None,
            discovery: CredentialDiscoveryKind::Amp,
        },
        docs_url: Some("https://ampcode.com".into()),
    }
}

fn opencode_descriptor() -> AgentDescriptor {
    AgentDescriptor {
        kind: AgentKind::OpenCode,
        native: None,
        agent_process: AgentProcessArtifactSpec {
            install: AgentProcessInstallSpec::RegistryBacked {
                registry_id: "opencode".into(),
                fallback: AgentProcessFallback::NpmPackage {
                    package: "opencode-ai".into(),
                    package_subdir: None,
                    source_build_binary_name: None,
                    executable_relpath: PathBuf::from("node_modules/.bin/opencode-ai"),
                },
            },
        },
        launch: LaunchSpecTemplate {
            executable_name: "opencode-ai".into(),
            default_args: vec![],
        },
        auth: AuthSpec {
            env_vars: vec![],
            login: None,
            discovery: CredentialDiscoveryKind::OpenCode,
        },
        docs_url: Some("https://github.com/opencode-ai/opencode".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_uses_direct_managed_npm_install() {
        let descriptor = claude_descriptor();

        match descriptor.agent_process.install {
            AgentProcessInstallSpec::ManagedNpmPackage {
                package,
                package_subdir,
                source_build_binary_name,
                executable_relpath,
            } => {
                assert_eq!(package, CLAUDE_AGENT_ACP_PACKAGE);
                assert_eq!(package_subdir, None);
                assert_eq!(source_build_binary_name, None);
                assert_eq!(
                    executable_relpath,
                    PathBuf::from("node_modules/.bin/claude-agent-acp")
                );
            }
            other => panic!("unexpected Claude install spec: {other:?}"),
        }

        assert_eq!(
            descriptor.docs_url.as_deref(),
            Some(CLAUDE_AGENT_ACP_DOCS_URL)
        );
    }

    #[test]
    fn codex_uses_prebuilt_managed_npm_install() {
        let descriptor = codex_descriptor();

        match descriptor.agent_process.install {
            AgentProcessInstallSpec::ManagedNpmPackage {
                package,
                package_subdir,
                source_build_binary_name,
                executable_relpath,
            } => {
                assert_eq!(package, CODEX_AGENT_ACP_PACKAGE);
                assert_eq!(package_subdir, None);
                assert_eq!(source_build_binary_name, None);
                assert_eq!(
                    executable_relpath,
                    PathBuf::from("node_modules/.bin/codex-acp")
                );
            }
            other => panic!("unexpected Codex install spec: {other:?}"),
        }

        assert_eq!(
            descriptor.docs_url.as_deref(),
            Some(CODEX_AGENT_ACP_DOCS_URL)
        );
    }

    #[test]
    fn remaining_agents_stay_registry_backed() {
        let registry = built_in_registry();

        for descriptor in registry {
            if matches!(descriptor.kind, AgentKind::Claude | AgentKind::Codex) {
                continue;
            }

            assert!(
                matches!(
                    descriptor.agent_process.install,
                    AgentProcessInstallSpec::RegistryBacked { .. }
                ),
                "expected {:?} to remain registry-backed",
                descriptor.kind
            );
        }
    }

    #[test]
    fn opencode_credentials_are_provider_managed() {
        let descriptor = opencode_descriptor();

        assert!(descriptor.auth.env_vars.is_empty());
        assert_eq!(descriptor.auth.discovery, CredentialDiscoveryKind::OpenCode);
        assert!(descriptor.auth.login.is_none());
    }
}
