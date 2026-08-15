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
            // expectedBinary is joined under the extracted tree and exec'd by
            // the launcher; keep it strictly tree-relative.
            let binary = std::path::Path::new(target.expected_binary.trim());
            if binary.is_absolute()
                || binary
                    .components()
                    .any(|c| !matches!(c, std::path::Component::Normal(_)))
            {
                anyhow::bail!(
                    "agent registry agent '{agent_kind}' direct_archive platform '{platform}' expectedBinary must be a relative path without '..' components"
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
#[path = "validation_tests.rs"]
mod tests;
