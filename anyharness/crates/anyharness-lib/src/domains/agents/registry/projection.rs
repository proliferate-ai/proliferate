use std::collections::HashMap;

use super::bundled::bundled_agent_registry_document;
use super::schema::{
    AgentRegistryAgent, AgentRegistryAgentProcessFallback, AgentRegistryAgentProcessInstall,
    AgentRegistryAuthMaterialization, AgentRegistryDocument, AgentRegistryNativeArtifact,
    AgentRegistryNativeInstall,
};
use super::validation::validate_agent_registry_document;
use crate::domains::agents::model::{
    AgentDescriptor, AgentKind, AgentProcessArtifactSpec, AgentProcessFallback,
    AgentProcessInstallSpec, AuthMaterializationSpec, AuthReadinessPolicy, AuthSlotSpec, AuthSpec,
    CommandSpec, CredentialDiscoveryKind, GatewayEnvMaterializationSpec, LaunchSpecTemplate,
    LoginSpec, NativeArtifactSpec, NativeInstallSpec, Platform, SyncedFilesMaterializationSpec,
};

/// Returns trusted process/auth descriptors from the bundled registry only.
pub fn bundled_agent_descriptors() -> Vec<AgentDescriptor> {
    agent_registry_to_descriptors(bundled_agent_registry_document())
        .expect("bundled agents registry descriptor projection must validate")
}

fn agent_registry_to_descriptors(
    registry: &AgentRegistryDocument,
) -> anyhow::Result<Vec<AgentDescriptor>> {
    validate_agent_registry_document(registry)?;
    registry
        .agents
        .iter()
        .map(agent_registry_agent_to_descriptor)
        .collect()
}

fn agent_registry_agent_to_descriptor(
    agent: &AgentRegistryAgent,
) -> anyhow::Result<AgentDescriptor> {
    let kind = AgentKind::parse(agent.kind.as_str())
        .ok_or_else(|| anyhow::anyhow!("unsupported agent kind '{}'", agent.kind))?;
    Ok(AgentDescriptor {
        kind,
        native: agent
            .native
            .as_ref()
            .map(agent_registry_native_to_spec)
            .transpose()?,
        agent_process: AgentProcessArtifactSpec {
            install: agent_registry_agent_process_install_to_spec(&agent.agent_process.install)?,
        },
        launch: LaunchSpecTemplate {
            executable_name: agent.launch.executable_name.clone(),
            default_args: agent.launch.default_args.clone(),
        },
        auth: AuthSpec {
            readiness_policy: parse_readiness_policy(agent.auth.readiness_policy.as_str())?,
            slots: agent
                .auth
                .slots
                .iter()
                .map(|slot| {
                    Ok(AuthSlotSpec {
                        id: slot.id.clone(),
                        label: slot.label.clone(),
                        credential_provider_ids: slot.credential_provider_ids.clone(),
                        required_for_readiness: slot.required_for_readiness,
                        env_vars: slot
                            .env_vars
                            .iter()
                            .map(|env_var| env_var.name().to_string())
                            .collect(),
                        login: slot.login.as_ref().map(|login| LoginSpec {
                            label: login.label.clone(),
                            command: CommandSpec {
                                program: login.command.program.clone(),
                                args: login.command.args.clone(),
                            },
                            reuses_user_state: login.reuses_user_state,
                            message: login.message.clone(),
                        }),
                        discovery: parse_credential_discovery(slot.discovery.as_str())?,
                        materialization: agent_registry_materialization_to_spec(
                            &slot.materialization,
                        ),
                    })
                })
                .collect::<anyhow::Result<Vec<_>>>()?,
        },
        docs_url: agent.docs_url.clone(),
    })
}

fn agent_registry_native_to_spec(
    artifact: &AgentRegistryNativeArtifact,
) -> anyhow::Result<NativeArtifactSpec> {
    let install = match &artifact.install {
        AgentRegistryNativeInstall::DirectBinary {
            latest_version_url,
            binary_url_template,
            platform_map,
        } => NativeInstallSpec::DirectBinary {
            latest_version_url: latest_version_url.clone(),
            binary_url_template: binary_url_template.clone(),
            platform_map: parse_platform_map(platform_map)?,
        },
        AgentRegistryNativeInstall::TarballRelease {
            latest_url_template,
            versioned_url_template,
            expected_binary_template,
            platform_map,
        } => NativeInstallSpec::TarballRelease {
            latest_url_template: latest_url_template.clone(),
            versioned_url_template: versioned_url_template.clone(),
            expected_binary_template: expected_binary_template.clone(),
            platform_map: parse_platform_map(platform_map)?,
        },
        AgentRegistryNativeInstall::PathOnly {
            candidate_binaries,
            docs_url,
        } => NativeInstallSpec::PathOnly {
            candidate_binaries: candidate_binaries.clone(),
            docs_url: docs_url.clone(),
        },
        AgentRegistryNativeInstall::Manual { docs_url } => NativeInstallSpec::Manual {
            docs_url: docs_url.clone(),
        },
    };
    Ok(NativeArtifactSpec { install })
}

fn agent_registry_agent_process_install_to_spec(
    install: &AgentRegistryAgentProcessInstall,
) -> anyhow::Result<AgentProcessInstallSpec> {
    Ok(match install {
        AgentRegistryAgentProcessInstall::RegistryBacked {
            registry_id,
            fallback,
        } => AgentProcessInstallSpec::RegistryBacked {
            registry_id: registry_id.clone(),
            fallback: agent_registry_fallback_to_spec(fallback),
        },
        AgentRegistryAgentProcessInstall::ManagedNpmPackage {
            package,
            package_subdir,
            source_build_binary_name,
            executable_relpath,
        } => AgentProcessInstallSpec::ManagedNpmPackage {
            package: package.clone(),
            package_subdir: package_subdir.clone(),
            source_build_binary_name: source_build_binary_name.clone(),
            executable_relpath: executable_relpath.clone(),
        },
        AgentRegistryAgentProcessInstall::PathOnly {
            candidate_binaries,
            default_args,
            docs_url,
        } => AgentProcessInstallSpec::PathOnly {
            candidate_binaries: candidate_binaries.clone(),
            default_args: default_args.clone(),
            docs_url: docs_url.clone(),
        },
        AgentRegistryAgentProcessInstall::Manual { docs_url } => AgentProcessInstallSpec::Manual {
            docs_url: docs_url.clone(),
        },
    })
}

fn agent_registry_fallback_to_spec(
    fallback: &AgentRegistryAgentProcessFallback,
) -> AgentProcessFallback {
    match fallback {
        AgentRegistryAgentProcessFallback::NpmPackage {
            package,
            package_subdir,
            source_build_binary_name,
            executable_relpath,
        } => AgentProcessFallback::NpmPackage {
            package: package.clone(),
            package_subdir: package_subdir.clone(),
            source_build_binary_name: source_build_binary_name.clone(),
            executable_relpath: executable_relpath.clone(),
        },
        AgentRegistryAgentProcessFallback::NativeSubcommand { args } => {
            AgentProcessFallback::NativeSubcommand { args: args.clone() }
        }
        AgentRegistryAgentProcessFallback::BinaryHint {
            candidate_binaries,
            args,
        } => AgentProcessFallback::BinaryHint {
            candidate_binaries: candidate_binaries.clone(),
            args: args.clone(),
        },
    }
}

fn agent_registry_materialization_to_spec(
    materialization: &AgentRegistryAuthMaterialization,
) -> AuthMaterializationSpec {
    AuthMaterializationSpec {
        gateway_env: materialization.gateway_env.as_ref().map(|gateway_env| {
            GatewayEnvMaterializationSpec {
                protocol_facade: gateway_env.protocol_facade.clone(),
                protected_env_keys: gateway_env.protected_env_keys.clone(),
                support_env_keys: gateway_env.support_env_keys.clone(),
            }
        }),
        synced_files: materialization.synced_files.as_ref().map(|synced_files| {
            SyncedFilesMaterializationSpec {
                protected_env_keys: synced_files.protected_env_keys.clone(),
                allowed_file_paths: synced_files.allowed_file_paths.clone(),
                cleanup_file_paths: synced_files.cleanup_file_paths.clone(),
            }
        }),
    }
}

fn parse_platform_map(raw: &HashMap<String, String>) -> anyhow::Result<Vec<(Platform, String)>> {
    raw.iter()
        .map(|(key, value)| Ok((parse_platform(key)?, value.clone())))
        .collect()
}

fn parse_platform(value: &str) -> anyhow::Result<Platform> {
    match value {
        "macos_arm64" => Ok(Platform::MacosArm64),
        "macos_x64" => Ok(Platform::MacosX64),
        "linux_x64" => Ok(Platform::LinuxX64),
        "linux_arm64" => Ok(Platform::LinuxArm64),
        "windows_x64" => Ok(Platform::WindowsX64),
        "windows_arm64" => Ok(Platform::WindowsArm64),
        _ => anyhow::bail!("unsupported platform key '{value}'"),
    }
}

fn parse_readiness_policy(value: &str) -> anyhow::Result<AuthReadinessPolicy> {
    match value {
        "any_required_slot" => Ok(AuthReadinessPolicy::AnyRequiredSlot),
        "all_required_slots" => Ok(AuthReadinessPolicy::AllRequiredSlots),
        "provider_managed" => Ok(AuthReadinessPolicy::ProviderManaged),
        "none" => Ok(AuthReadinessPolicy::None),
        _ => anyhow::bail!("unsupported auth readiness policy '{value}'"),
    }
}

fn parse_credential_discovery(value: &str) -> anyhow::Result<CredentialDiscoveryKind> {
    match value {
        "none" => Ok(CredentialDiscoveryKind::None),
        "claude" => Ok(CredentialDiscoveryKind::Claude),
        "codex" => Ok(CredentialDiscoveryKind::Codex),
        "gemini" => Ok(CredentialDiscoveryKind::Gemini),
        "opencode" => Ok(CredentialDiscoveryKind::OpenCode),
        "cursor" => Ok(CredentialDiscoveryKind::Cursor),
        "grok" => Ok(CredentialDiscoveryKind::Grok),
        _ => anyhow::bail!("unsupported credential discovery '{value}'"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::model::{AgentKind, CredentialDiscoveryKind};

    #[test]
    fn bundled_codex_launch_disables_user_profile_extensions() {
        let codex = bundled_agent_descriptors()
            .into_iter()
            .find(|descriptor| descriptor.kind == AgentKind::Codex)
            .expect("codex descriptor");

        let args = codex.launch.default_args;
        for expected in [
            "features.plugins=false",
            "features.tool_suggest=false",
            "plugins={}",
            "marketplaces={}",
            "mcp_servers={}",
        ] {
            assert!(
                args.windows(2)
                    .any(|pair| pair[0] == "-c" && pair[1] == expected),
                "missing Codex launch override {expected}"
            );
        }
    }

    #[test]
    fn bundled_opencode_has_multiple_provider_slots() {
        let opencode = bundled_agent_descriptors()
            .into_iter()
            .find(|descriptor| descriptor.kind == AgentKind::OpenCode)
            .expect("opencode descriptor");

        let slot_ids = opencode
            .auth
            .slots
            .iter()
            .map(|slot| slot.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            slot_ids,
            vec!["openai", "anthropic", "gemini", "opencode-zen"]
        );
    }

    #[test]
    fn bundled_grok_uses_registry_backed_install_and_xai_slot() {
        let grok = bundled_agent_descriptors()
            .into_iter()
            .find(|descriptor| descriptor.kind == AgentKind::Grok)
            .expect("grok descriptor");

        assert_eq!(grok.launch.executable_name, "grok");

        let slot = grok.auth.slots.first().expect("grok auth slot");
        assert_eq!(slot.id, "xai");
        assert_eq!(slot.discovery, CredentialDiscoveryKind::Grok);
        assert_eq!(slot.credential_provider_ids, vec!["xai".to_string()]);

        let synced = slot
            .materialization
            .synced_files
            .as_ref()
            .expect("grok synced files");
        assert_eq!(
            synced.allowed_file_paths,
            vec![".grok/auth.json".to_string()]
        );
    }
}
