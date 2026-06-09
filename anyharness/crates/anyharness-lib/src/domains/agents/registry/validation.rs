use std::collections::HashSet;

use chrono::DateTime;

use super::schema::{AgentRegistryAgent, AgentRegistryAuth, AgentRegistryDocument};
use crate::domains::agents::model::AgentKind;

const VALID_CREDENTIAL_PROVIDER_IDS: &[&str] = &["anthropic", "openai", "gemini", "cursor"];

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
    validate_auth(&agent.kind, &agent.auth)
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
        if slot.credential_provider_ids.is_empty() {
            anyhow::bail!(
                "agent registry agent '{}' auth slot '{}' has no credential providers",
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
