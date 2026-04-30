use anyharness_contract::v1::{
    AgentSeedFailureKind, AgentSeedHealth, AgentSeedLastAction, AgentSeedOwnership,
    AgentSeedSource, AgentSeedStatus,
};

use crate::agents::model::Platform;

use super::types::{AgentSeedArtifactOwner, AgentSeedState};

pub(super) fn not_configured_dev_health() -> AgentSeedHealth {
    AgentSeedHealth {
        status: AgentSeedStatus::NotConfiguredDev,
        source: AgentSeedSource::None,
        ownership: AgentSeedOwnership::NotConfigured,
        seed_version: None,
        target: Platform::current_target_triple().map(str::to_string),
        seeded_agents: Vec::new(),
        last_action: AgentSeedLastAction::None,
        seed_owned_artifact_count: 0,
        skipped_existing_artifact_count: 0,
        repaired_artifact_count: 0,
        failure_kind: None,
    }
}

pub(super) fn missing_bundled_seed_health(target: &str) -> AgentSeedHealth {
    AgentSeedHealth {
        status: AgentSeedStatus::MissingBundledSeed,
        source: AgentSeedSource::Bundled,
        ownership: AgentSeedOwnership::NotConfigured,
        seed_version: None,
        target: Some(target.to_string()),
        seeded_agents: Vec::new(),
        last_action: AgentSeedLastAction::None,
        seed_owned_artifact_count: 0,
        skipped_existing_artifact_count: 0,
        repaired_artifact_count: 0,
        failure_kind: Some(AgentSeedFailureKind::MissingArchive),
    }
}

pub(super) fn failed_health(
    failure_kind: AgentSeedFailureKind,
    source: AgentSeedSource,
) -> AgentSeedHealth {
    AgentSeedHealth {
        status: AgentSeedStatus::Failed,
        source,
        ownership: AgentSeedOwnership::NotConfigured,
        seed_version: None,
        target: Platform::current_target_triple().map(str::to_string),
        seeded_agents: Vec::new(),
        last_action: AgentSeedLastAction::None,
        seed_owned_artifact_count: 0,
        skipped_existing_artifact_count: 0,
        repaired_artifact_count: 0,
        failure_kind: Some(failure_kind),
    }
}

pub(super) fn health_from_state(
    state: &AgentSeedState,
    source: AgentSeedSource,
) -> AgentSeedHealth {
    let seed_owned = state
        .artifacts
        .iter()
        .filter(|record| record.owner == AgentSeedArtifactOwner::Seed)
        .count() as u32;
    let total = state.artifacts.len() as u32;
    let ownership = if total == 0 {
        AgentSeedOwnership::NotConfigured
    } else if seed_owned == total {
        AgentSeedOwnership::FullSeed
    } else if seed_owned == 0 {
        AgentSeedOwnership::UserOwnedExisting
    } else {
        AgentSeedOwnership::PartialSeed
    };
    let status = match ownership {
        AgentSeedOwnership::FullSeed => AgentSeedStatus::Ready,
        AgentSeedOwnership::PartialSeed | AgentSeedOwnership::UserOwnedExisting => {
            AgentSeedStatus::Partial
        }
        AgentSeedOwnership::NotConfigured => AgentSeedStatus::Failed,
    };

    AgentSeedHealth {
        status,
        source,
        ownership,
        seed_version: state.seed_version.clone(),
        target: state.target.clone(),
        seeded_agents: state.seeded_agents.clone(),
        last_action: state.last_action.clone(),
        seed_owned_artifact_count: seed_owned,
        skipped_existing_artifact_count: state.skipped_existing_artifact_count,
        repaired_artifact_count: state.repaired_artifact_count,
        failure_kind: None,
    }
}
