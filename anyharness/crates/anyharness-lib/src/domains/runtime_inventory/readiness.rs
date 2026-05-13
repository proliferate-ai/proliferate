use std::path::Path;

use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agents::readiness::resolver::resolve_agent;
use crate::domains::agents::registry::built_in_registry;

use super::model::{RuntimeReadinessEntry, RuntimeReadinessState};

pub fn collect_provider_readiness(runtime_home: &Path) -> Vec<RuntimeReadinessEntry> {
    built_in_registry()
        .iter()
        .map(|descriptor| {
            let resolved = resolve_agent(descriptor, runtime_home);
            RuntimeReadinessEntry {
                id: descriptor.kind.as_str().to_string(),
                display_name: Some(descriptor.kind.display_name().to_string()),
                state: readiness_state(resolved.status),
                message: resolved
                    .agent_process
                    .message
                    .or_else(|| resolved.native.and_then(|artifact| artifact.message)),
            }
        })
        .collect()
}

fn readiness_state(status: ResolvedAgentStatus) -> RuntimeReadinessState {
    match status {
        ResolvedAgentStatus::Ready => RuntimeReadinessState::Ready,
        ResolvedAgentStatus::InstallRequired => RuntimeReadinessState::InstallRequired,
        ResolvedAgentStatus::CredentialsRequired => RuntimeReadinessState::CredentialsRequired,
        ResolvedAgentStatus::LoginRequired => RuntimeReadinessState::LoginRequired,
        ResolvedAgentStatus::Unsupported => RuntimeReadinessState::Unsupported,
        ResolvedAgentStatus::Error => RuntimeReadinessState::Error,
    }
}
