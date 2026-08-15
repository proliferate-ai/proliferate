use std::collections::HashSet;

use chrono::DateTime;

use super::schema::{AgentRegistryAgent, AgentRegistryAuth, AgentRegistryDocument};
use crate::domains::agents::model::AgentKind;

const VALID_CREDENTIAL_PROVIDER_IDS: &[&str] = &["anthropic", "openai", "gemini", "cursor", "xai"];

// The closed vocabulary of storable vault-entry shapes (agent-auth.md's "The
// vault" table); mirrors constants/agent_gateway.py's AGENT_API_KEY_TYPED_KINDS
// on the Python side. Which harness may declare which kind is registry data,
// not a Rust constant — this list only bounds what a `kind` string may be.
const VALID_PROVIDER_CONFIG_KINDS: &[&str] = &["aws_bedrock", "azure_openai"];

pub fn validate_agent_registry_document(registry: &AgentRegistryDocument) -> anyhow::Result<()> {
    if registry.schema_version != 1 {
        anyhow::bail!("agent registry schema version is not supported");
    }
    if registry.registry_version.trim().is_empty() {
        anyhow::bail!("agent registry version is empty");
    }
    DateTime::parse_from_rfc3339(&registry.generated_at)?;
    if registry.agents.is_empty() {
        anyhow::bail!("agent registry has no agents");
    }

    let mut seen_agents = HashSet::new();
    for agent in &registry.agents {
        validate_agent(agent, &mut seen_agents)?;
    }
    Ok(())
}

fn validate_agent(
    agent: &AgentRegistryAgent,
    seen_agents: &mut HashSet<String>,
) -> anyhow::Result<()> {
    if AgentKind::parse(agent.kind.as_str()).is_none() {
        anyhow::bail!("agent registry agent '{}' is not supported", agent.kind);
    }
    if !seen_agents.insert(agent.kind.clone()) {
        anyhow::bail!("agent registry agent '{}' is duplicated", agent.kind);
    }
    if agent.display_name.trim().is_empty() {
        anyhow::bail!(
            "agent registry agent '{}' display name is empty",
            agent.kind
        );
    }
    if agent.launch.executable_name.trim().is_empty() {
        anyhow::bail!(
            "agent registry agent '{}' launch executable is empty",
            agent.kind
        );
    }
    validate_auth(&agent.kind, &agent.auth)?;
    validate_self_update_neutralization(&agent.kind, &agent.self_update_neutralization)?;
    validate_agent_process_install(&agent.kind, &agent.agent_process.install)?;
    validate_provider_config(&agent.kind, &agent.provider_config)
}

fn validate_agent_process_install(
    agent_kind: &str,
    install: &crate::domains::agents::registry::schema::AgentRegistryAgentProcessInstall,
) -> anyhow::Result<()> {
    use crate::domains::agents::registry::schema::AgentRegistryAgentProcessInstall;
    // Only the additive direct_archive kind carries integrity fields the schema
    // cannot fully constrain; the other kinds are validated at projection time.
    if let AgentRegistryAgentProcessInstall::DirectArchive { platforms, .. } = install {
        if platforms.is_empty() {
            anyhow::bail!(
                "agent registry agent '{agent_kind}' direct_archive declares no platforms"
            );
        }
        for (platform, target) in platforms {
            if target.url.trim().is_empty() {
                anyhow::bail!(
                    "agent registry agent '{agent_kind}' direct_archive platform '{platform}' has an empty url"
                );
            }
            if target.expected_binary.trim().is_empty() {
                anyhow::bail!(
                    "agent registry agent '{agent_kind}' direct_archive platform '{platform}' has an empty expectedBinary"
                );
            }
            let sha = target.sha256.trim();
            if sha.len() != 64 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
                anyhow::bail!(
                    "agent registry agent '{agent_kind}' direct_archive platform '{platform}' sha256 must be 64 hex chars"
                );
            }
        }
    }
    Ok(())
}

const VALID_SELF_UPDATE_MECHANISMS: &[&str] = &["env", "none_found", "not_applicable"];

fn validate_self_update_neutralization(
    agent_kind: &str,
    neutralization: &crate::domains::agents::registry::schema::AgentRegistrySelfUpdateNeutralization,
) -> anyhow::Result<()> {
    if !VALID_SELF_UPDATE_MECHANISMS.contains(&neutralization.mechanism.as_str()) {
        anyhow::bail!(
            "agent registry agent '{}' selfUpdateNeutralization mechanism '{}' is not supported",
            agent_kind,
            neutralization.mechanism
        );
    }
    if neutralization.detail.trim().is_empty() {
        anyhow::bail!(
            "agent registry agent '{}' selfUpdateNeutralization detail is empty",
            agent_kind
        );
    }
    // An `env` mechanism must actually declare at least one var to inject;
    // non-env mechanisms must not carry env vars (they document a finding).
    if neutralization.mechanism == "env" {
        if neutralization.env.is_empty() {
            anyhow::bail!(
                "agent registry agent '{}' selfUpdateNeutralization mechanism 'env' declares no env vars",
                agent_kind
            );
        }
        for var in &neutralization.env {
            if var.name.trim().is_empty() {
                anyhow::bail!(
                    "agent registry agent '{}' selfUpdateNeutralization env var name is empty",
                    agent_kind
                );
            }
        }
    } else if !neutralization.env.is_empty() {
        anyhow::bail!(
            "agent registry agent '{}' selfUpdateNeutralization mechanism '{}' must not declare env vars",
            agent_kind,
            neutralization.mechanism
        );
    }
    Ok(())
}

fn validate_provider_config(
    agent_kind: &str,
    provider_config: &[crate::domains::agents::registry::schema::AgentRegistryProviderConfig],
) -> anyhow::Result<()> {
    let mut seen_kinds = HashSet::new();
    for entry in provider_config {
        if !VALID_PROVIDER_CONFIG_KINDS.contains(&entry.kind.as_str()) {
            anyhow::bail!(
                "agent registry agent '{}' providerConfig kind '{}' is not supported",
                agent_kind,
                entry.kind
            );
        }
        if !seen_kinds.insert(entry.kind.clone()) {
            anyhow::bail!(
                "agent registry agent '{}' providerConfig kind '{}' is duplicated",
                agent_kind,
                entry.kind
            );
        }
        if entry.label.trim().is_empty() {
            anyhow::bail!(
                "agent registry agent '{}' providerConfig kind '{}' label is empty",
                agent_kind,
                entry.kind
            );
        }
        if entry.env_vars.is_empty() {
            anyhow::bail!(
                "agent registry agent '{}' providerConfig kind '{}' has no env vars",
                agent_kind,
                entry.kind
            );
        }
        if entry.pending
            && entry
                .pending_reason
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            anyhow::bail!(
                "agent registry agent '{}' providerConfig kind '{}' is pending but has no pendingReason",
                agent_kind,
                entry.kind
            );
        }
        let mut seen_env_vars = HashSet::new();
        for env_var in &entry.env_vars {
            if env_var.name().trim().is_empty() {
                anyhow::bail!(
                    "agent registry agent '{}' providerConfig kind '{}' has empty env var name",
                    agent_kind,
                    entry.kind
                );
            }
            if !seen_env_vars.insert(env_var.name().to_string()) {
                anyhow::bail!(
                    "agent registry agent '{}' providerConfig kind '{}' env var '{}' is duplicated",
                    agent_kind,
                    entry.kind,
                    env_var.name()
                );
            }
        }
    }
    Ok(())
}

fn validate_auth(agent_kind: &str, auth: &AgentRegistryAuth) -> anyhow::Result<()> {
    if !matches!(
        auth.readiness_policy.as_str(),
        "any_required_slot" | "all_required_slots" | "provider_managed" | "none"
    ) {
        anyhow::bail!(
            "agent registry agent '{}' has unsupported readiness policy '{}'",
            agent_kind,
            auth.readiness_policy
        );
    }
    if auth.readiness_policy != "none" && auth.slots.is_empty() {
        anyhow::bail!("agent registry agent '{}' auth has no slots", agent_kind);
    }

    let mut seen_slots = HashSet::new();
    let mut required_count = 0;
    for slot in &auth.slots {
        if slot.id.trim().is_empty() {
            anyhow::bail!(
                "agent registry agent '{}' has empty auth slot id",
                agent_kind
            );
        }
        if !seen_slots.insert(slot.id.clone()) {
            anyhow::bail!(
                "agent registry agent '{}' auth slot '{}' is duplicated",
                agent_kind,
                slot.id
            );
        }
        if slot.label.trim().is_empty() {
            anyhow::bail!(
                "agent registry agent '{}' auth slot '{}' label is empty",
                agent_kind,
                slot.id
            );
        }
        // Discovery-only slots (detectable local auth with no managed
        // credential backing, e.g. opencode-zen) may declare no providers —
        // but a slot REQUIRED for readiness must be satisfiable through
        // managed credentials, so it must name at least one.
        if slot.credential_provider_ids.is_empty() && slot.required_for_readiness {
            anyhow::bail!(
                "agent registry agent '{}' required auth slot '{}' has no credential providers",
                agent_kind,
                slot.id
            );
        }
        for provider_id in &slot.credential_provider_ids {
            if !VALID_CREDENTIAL_PROVIDER_IDS.contains(&provider_id.as_str()) {
                anyhow::bail!(
                    "agent registry agent '{}' auth slot '{}' has unsupported credential provider '{}'",
                    agent_kind,
                    slot.id,
                    provider_id
                );
            }
        }
        let mut seen_env_vars = HashSet::new();
        for env_var in &slot.env_vars {
            if env_var.name().trim().is_empty() {
                anyhow::bail!(
                    "agent registry agent '{}' auth slot '{}' has empty env var name",
                    agent_kind,
                    slot.id
                );
            }
            if !seen_env_vars.insert(env_var.name().to_string()) {
                anyhow::bail!(
                    "agent registry agent '{}' auth slot '{}' env var '{}' is duplicated",
                    agent_kind,
                    slot.id,
                    env_var.name()
                );
            }
        }
        let mut seen_discovery_kinds = HashSet::new();
        for discovery_kind in &slot.discovery_kinds {
            if discovery_kind.trim().is_empty() {
                anyhow::bail!(
                    "agent registry agent '{}' auth slot '{}' has empty discovery kind",
                    agent_kind,
                    slot.id
                );
            }
            if !seen_discovery_kinds.insert(discovery_kind.clone()) {
                anyhow::bail!(
                    "agent registry agent '{}' auth slot '{}' discovery kind '{}' is duplicated",
                    agent_kind,
                    slot.id,
                    discovery_kind
                );
            }
        }
        if slot.required_for_readiness {
            required_count += 1;
        }
        if let Some(synced_files) = &slot.materialization.synced_files {
            for cleanup_path in &synced_files.cleanup_file_paths {
                if !synced_files
                    .allowed_file_paths
                    .iter()
                    .any(|allowed_path| allowed_path == cleanup_path)
                {
                    anyhow::bail!(
                        "agent registry agent '{}' auth slot '{}' cleanup file path '{}' is not allowed",
                        agent_kind,
                        slot.id,
                        cleanup_path
                    );
                }
            }
        }
    }

    if matches!(
        auth.readiness_policy.as_str(),
        "any_required_slot" | "all_required_slots"
    ) && required_count == 0
    {
        anyhow::bail!(
            "agent registry agent '{}' readiness policy requires at least one required slot",
            agent_kind
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::registry::bundled::bundled_agent_registry_document;
    use crate::domains::agents::registry::schema::AgentRegistryAuthSlotEnvVar;

    #[test]
    fn registry_rejects_duplicate_env_var_names() {
        let mut registry = bundled_agent_registry_document().clone();
        let slot = &mut registry.agents[0].auth.slots[0];
        slot.env_vars.push(AgentRegistryAuthSlotEnvVar::Name(
            "ANTHROPIC_API_KEY".to_string(),
        ));

        let error =
            validate_agent_registry_document(&registry).expect_err("duplicate env var must fail");

        assert!(
            error
                .to_string()
                .contains("env var 'ANTHROPIC_API_KEY' is duplicated"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn registry_rejects_empty_discovery_kind() {
        let mut registry = bundled_agent_registry_document().clone();
        registry.agents[0].auth.slots[0]
            .discovery_kinds
            .push("  ".to_string());

        let error = validate_agent_registry_document(&registry)
            .expect_err("empty discovery kind must fail");

        assert!(
            error.to_string().contains("has empty discovery kind"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn registry_rejects_unsupported_self_update_mechanism() {
        let mut registry = bundled_agent_registry_document().clone();
        registry.agents[0].self_update_neutralization.mechanism = "auto_magic".to_string();

        let error = validate_agent_registry_document(&registry)
            .expect_err("unsupported self-update mechanism must fail");
        assert!(
            error
                .to_string()
                .contains("selfUpdateNeutralization mechanism 'auto_magic' is not supported"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn registry_rejects_env_mechanism_without_vars() {
        use crate::domains::agents::registry::schema::AgentRegistrySelfUpdateNeutralization;
        let mut registry = bundled_agent_registry_document().clone();
        registry.agents[0].self_update_neutralization = AgentRegistrySelfUpdateNeutralization {
            mechanism: "env".to_string(),
            detail: "claims env but declares nothing".to_string(),
            env: vec![],
        };

        let error = validate_agent_registry_document(&registry)
            .expect_err("env mechanism with no vars must fail");
        assert!(
            error.to_string().contains("declares no env vars"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn registry_rejects_non_env_mechanism_carrying_env_vars() {
        use crate::domains::agents::registry::schema::{
            AgentRegistrySelfUpdateEnvVar, AgentRegistrySelfUpdateNeutralization,
        };
        let mut registry = bundled_agent_registry_document().clone();
        registry.agents[0].self_update_neutralization = AgentRegistrySelfUpdateNeutralization {
            mechanism: "none_found".to_string(),
            detail: "no updater found".to_string(),
            env: vec![AgentRegistrySelfUpdateEnvVar {
                name: "X".to_string(),
                value: "1".to_string(),
            }],
        };

        let error = validate_agent_registry_document(&registry)
            .expect_err("non-env mechanism carrying env vars must fail");
        assert!(
            error.to_string().contains("must not declare env vars"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn registry_accepts_valid_direct_archive_and_rejects_bad_sha() {
        use crate::domains::agents::registry::schema::{
            AgentRegistryAgentProcessArchiveTarget, AgentRegistryAgentProcessInstall,
        };
        use std::collections::HashMap;

        let mut registry = bundled_agent_registry_document().clone();
        let mut platforms = HashMap::new();
        platforms.insert(
            "macos_arm64".to_string(),
            AgentRegistryAgentProcessArchiveTarget {
                url: "https://downloads.test/agent.tar.gz".to_string(),
                sha256: "a".repeat(64),
                expected_binary: "pkg/agent".to_string(),
                size: None,
            },
        );
        registry.agents[0].agent_process.install =
            AgentRegistryAgentProcessInstall::DirectArchive {
                platforms,
                args: vec!["acp".to_string()],
            };
        validate_agent_registry_document(&registry)
            .expect("a well-formed direct_archive install must validate");

        let mut bad = HashMap::new();
        bad.insert(
            "macos_arm64".to_string(),
            AgentRegistryAgentProcessArchiveTarget {
                url: "https://downloads.test/agent.tar.gz".to_string(),
                sha256: "not-a-sha".to_string(),
                expected_binary: "pkg/agent".to_string(),
                size: None,
            },
        );
        registry.agents[0].agent_process.install =
            AgentRegistryAgentProcessInstall::DirectArchive {
                platforms: bad,
                args: vec![],
            };
        let error = validate_agent_registry_document(&registry)
            .expect_err("a bad direct_archive sha256 must fail");
        assert!(
            error.to_string().contains("sha256 must be 64 hex"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn bundled_registry_self_update_neutralization_validates() {
        // The bundled document's per-harness selfUpdateNeutralization records
        // (claude=env DISABLE_AUTOUPDATER, others=none_found) must already pass.
        validate_agent_registry_document(bundled_agent_registry_document())
            .expect("bundled registry self-update neutralization must validate");
    }

    #[test]
    fn bundled_registry_provider_config_validates() {
        // The bundled document's claude/codex/opencode providerConfig blocks
        // must already pass — this pins that Track D's declarations are
        // valid, not just parseable.
        validate_agent_registry_document(bundled_agent_registry_document())
            .expect("bundled registry with providerConfig must validate");
    }

    #[test]
    fn registry_rejects_unsupported_provider_config_kind() {
        use crate::domains::agents::registry::schema::AgentRegistryProviderConfig;

        let mut registry = bundled_agent_registry_document().clone();
        registry.agents[0]
            .provider_config
            .push(AgentRegistryProviderConfig {
                kind: "google_vertex".to_string(),
                label: "Google Vertex".to_string(),
                env_vars: vec![AgentRegistryAuthSlotEnvVar::Name(
                    "ANTHROPIC_VERTEX_PROJECT_ID".to_string(),
                )],
                pending: false,
                pending_reason: None,
            });

        let error = validate_agent_registry_document(&registry)
            .expect_err("unsupported providerConfig kind must fail");

        assert!(
            error
                .to_string()
                .contains("providerConfig kind 'google_vertex' is not supported"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn registry_rejects_duplicate_provider_config_kind() {
        use crate::domains::agents::registry::schema::AgentRegistryProviderConfig;

        let mut registry = bundled_agent_registry_document().clone();
        let duplicate = registry.agents[0].provider_config[0].clone();
        registry.agents[0]
            .provider_config
            .push(AgentRegistryProviderConfig {
                kind: duplicate.kind.clone(),
                label: duplicate.label.clone(),
                env_vars: duplicate.env_vars.clone(),
                pending: duplicate.pending,
                pending_reason: duplicate.pending_reason.clone(),
            });

        let error = validate_agent_registry_document(&registry)
            .expect_err("duplicate providerConfig kind must fail");

        assert!(
            error.to_string().contains("is duplicated"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn registry_rejects_provider_config_with_no_env_vars() {
        use crate::domains::agents::registry::schema::AgentRegistryProviderConfig;

        let mut registry = bundled_agent_registry_document().clone();
        registry.agents[0].provider_config = vec![AgentRegistryProviderConfig {
            kind: "aws_bedrock".to_string(),
            label: "AWS Bedrock".to_string(),
            env_vars: vec![],
            pending: false,
            pending_reason: None,
        }];

        let error = validate_agent_registry_document(&registry)
            .expect_err("providerConfig with no env vars must fail");

        assert!(
            error.to_string().contains("has no env vars"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn registry_rejects_provider_config_duplicate_env_var() {
        use crate::domains::agents::registry::schema::AgentRegistryProviderConfig;

        let mut registry = bundled_agent_registry_document().clone();
        registry.agents[0].provider_config = vec![AgentRegistryProviderConfig {
            kind: "aws_bedrock".to_string(),
            label: "AWS Bedrock".to_string(),
            env_vars: vec![
                AgentRegistryAuthSlotEnvVar::Name("AWS_REGION".to_string()),
                AgentRegistryAuthSlotEnvVar::Name("AWS_REGION".to_string()),
            ],
            pending: false,
            pending_reason: None,
        }];

        let error = validate_agent_registry_document(&registry)
            .expect_err("duplicate providerConfig env var must fail");

        assert!(
            error
                .to_string()
                .contains("env var 'AWS_REGION' is duplicated"),
            "unexpected error: {error}"
        );
    }
}
