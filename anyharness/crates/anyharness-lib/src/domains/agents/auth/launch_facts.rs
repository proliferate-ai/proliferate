//! Credential-fact collection for auth-context classification, sourced from
//! the COMPOSED launch env — never the ambient process env (decisions
//! ledger 8): env presence is the readiness env key set; values are read
//! only for registry-declared flag vars. This is the effectful doorstep in
//! front of the pure classifier (`context::classify`).

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use anyharness_credential_discovery::CredentialFact;

use crate::domains::agents::registry::bundled::bundled_agent_registry_document;
use crate::domains::agents::registry::schema::AgentRegistryEnvVarKind;

pub fn collect_launch_env_facts(
    agent_kind: &str,
    readiness_env: &BTreeMap<String, String>,
) -> Vec<CredentialFact> {
    let env_keys: BTreeSet<String> = readiness_env.keys().cloned().collect();
    let mut flag_values: BTreeMap<String, String> = BTreeMap::new();
    if let Some(agent) = bundled_agent_registry_document()
        .agents
        .iter()
        .find(|agent| agent.kind == agent_kind)
    {
        for slot in &agent.auth.slots {
            for env_var in &slot.env_vars {
                if env_var.kind() != AgentRegistryEnvVarKind::Flag {
                    continue;
                }
                if let Some(value) = readiness_env.get(env_var.name()) {
                    flag_values.insert(env_var.name().to_string(), value.clone());
                }
            }
        }
    }
    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    anyharness_credential_discovery::collect_facts(&home_dir, &env_keys, &flag_values)
}
