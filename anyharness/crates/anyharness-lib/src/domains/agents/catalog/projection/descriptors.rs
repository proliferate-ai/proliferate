use std::collections::HashMap;

use crate::domains::agents::catalog::bundled::bundled_agent_catalog_document;
use crate::domains::agents::catalog::schema::{
    AgentCatalogAgent, AgentCatalogAgentProcessFallback, AgentCatalogAgentProcessInstall,
    AgentCatalogDocument, AgentCatalogNativeArtifact, AgentCatalogNativeInstall,
};
use crate::domains::agents::catalog::validation::validate_agent_catalog_document;
use crate::domains::agents::model::{
    AgentDescriptor, AgentKind, AgentProcessArtifactSpec, AgentProcessFallback,
    AgentProcessInstallSpec, AuthSpec, CommandSpec, CredentialDiscoveryKind, LaunchSpecTemplate,
    LoginSpec, NativeArtifactSpec, NativeInstallSpec, Platform,
};

/// Returns trusted process/auth descriptors from the bundled catalog only.
pub fn bundled_agent_descriptors() -> Vec<AgentDescriptor> {
    match bundled_agent_catalog_document()
        .and_then(|catalog| agent_catalog_to_descriptors(&catalog))
    {
        Ok(descriptors) => descriptors,
        Err(error) => {
            tracing::error!(error = %error, "bundled agent catalog process descriptors are invalid");
            vec![]
        }
    }
}

pub fn agent_catalog_to_descriptors(
    catalog: &AgentCatalogDocument,
) -> anyhow::Result<Vec<AgentDescriptor>> {
    validate_agent_catalog_document(catalog)?;
    catalog
        .agents
        .iter()
        .map(agent_catalog_agent_to_descriptor)
        .collect()
}

fn agent_catalog_agent_to_descriptor(agent: &AgentCatalogAgent) -> anyhow::Result<AgentDescriptor> {
    let kind = AgentKind::parse(agent.kind.as_str())
        .ok_or_else(|| anyhow::anyhow!("unsupported agent kind '{}'", agent.kind))?;
    Ok(AgentDescriptor {
        kind,
        native: agent
            .process
            .native
            .as_ref()
            .map(agent_catalog_native_to_spec)
            .transpose()?,
        agent_process: AgentProcessArtifactSpec {
            install: agent_catalog_agent_process_install_to_spec(
                &agent.process.agent_process.install,
            )?,
        },
        launch: LaunchSpecTemplate {
            executable_name: agent.process.launch.executable_name.clone(),
            default_args: agent.process.launch.default_args.clone(),
        },
        auth: AuthSpec {
            env_vars: agent.process.auth.env_vars.clone(),
            login: agent.process.auth.login.as_ref().map(|login| LoginSpec {
                label: login.label.clone(),
                command: CommandSpec {
                    program: login.command.program.clone(),
                    args: login.command.args.clone(),
                },
                reuses_user_state: login.reuses_user_state,
                message: login.message.clone(),
            }),
            discovery: parse_credential_discovery(agent.process.auth.discovery.as_str())?,
        },
        docs_url: agent.process.docs_url.clone(),
    })
}

fn agent_catalog_native_to_spec(
    artifact: &AgentCatalogNativeArtifact,
) -> anyhow::Result<NativeArtifactSpec> {
    let install = match &artifact.install {
        AgentCatalogNativeInstall::DirectBinary {
            latest_version_url,
            binary_url_template,
            platform_map,
        } => NativeInstallSpec::DirectBinary {
            latest_version_url: latest_version_url.clone(),
            binary_url_template: binary_url_template.clone(),
            platform_map: parse_platform_map(platform_map)?,
        },
        AgentCatalogNativeInstall::TarballRelease {
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
        AgentCatalogNativeInstall::PathOnly {
            candidate_binaries,
            docs_url,
        } => NativeInstallSpec::PathOnly {
            candidate_binaries: candidate_binaries.clone(),
            docs_url: docs_url.clone(),
        },
        AgentCatalogNativeInstall::Manual { docs_url } => NativeInstallSpec::Manual {
            docs_url: docs_url.clone(),
        },
    };
    Ok(NativeArtifactSpec { install })
}

fn agent_catalog_agent_process_install_to_spec(
    install: &AgentCatalogAgentProcessInstall,
) -> anyhow::Result<AgentProcessInstallSpec> {
    Ok(match install {
        AgentCatalogAgentProcessInstall::RegistryBacked {
            registry_id,
            fallback,
        } => AgentProcessInstallSpec::RegistryBacked {
            registry_id: registry_id.clone(),
            fallback: agent_catalog_fallback_to_spec(fallback),
        },
        AgentCatalogAgentProcessInstall::ManagedNpmPackage {
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
        AgentCatalogAgentProcessInstall::PathOnly {
            candidate_binaries,
            default_args,
            docs_url,
        } => AgentProcessInstallSpec::PathOnly {
            candidate_binaries: candidate_binaries.clone(),
            default_args: default_args.clone(),
            docs_url: docs_url.clone(),
        },
        AgentCatalogAgentProcessInstall::Manual { docs_url } => AgentProcessInstallSpec::Manual {
            docs_url: docs_url.clone(),
        },
    })
}

fn agent_catalog_fallback_to_spec(
    fallback: &AgentCatalogAgentProcessFallback,
) -> AgentProcessFallback {
    match fallback {
        AgentCatalogAgentProcessFallback::NpmPackage {
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
        AgentCatalogAgentProcessFallback::NativeSubcommand { args } => {
            AgentProcessFallback::NativeSubcommand { args: args.clone() }
        }
        AgentCatalogAgentProcessFallback::BinaryHint {
            candidate_binaries,
            args,
        } => AgentProcessFallback::BinaryHint {
            candidate_binaries: candidate_binaries.clone(),
            args: args.clone(),
        },
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

fn parse_credential_discovery(value: &str) -> anyhow::Result<CredentialDiscoveryKind> {
    match value {
        "none" => Ok(CredentialDiscoveryKind::None),
        "claude" => Ok(CredentialDiscoveryKind::Claude),
        "codex" => Ok(CredentialDiscoveryKind::Codex),
        "gemini" => Ok(CredentialDiscoveryKind::Gemini),
        "opencode" => Ok(CredentialDiscoveryKind::OpenCode),
        "cursor" => Ok(CredentialDiscoveryKind::Cursor),
        _ => anyhow::bail!("unsupported credential discovery '{value}'"),
    }
}
