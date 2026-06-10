use anyharness_contract::v1::{
    AgentAuthExternalScope, AgentAuthSelectionConfig, AgentAuthSelectionStatus,
};

use crate::domains::agents::registry::built_in_registry;

use super::{AgentAuthConfigInput, AgentAuthConfigStatus};

pub(super) fn status_response(
    external_scope: Option<AgentAuthExternalScope>,
    revision: i64,
    config: &AgentAuthConfigInput,
) -> AgentAuthConfigStatus {
    AgentAuthConfigStatus {
        external_auth_scope: external_scope,
        revision: Some(revision),
        status: "applied".to_string(),
        selections: config.selections.iter().map(selection_status).collect(),
    }
}

fn selection_status(selection: &AgentAuthSelectionConfig) -> AgentAuthSelectionStatus {
    AgentAuthSelectionStatus {
        agent_kind: selection.agent_kind.clone(),
        auth_slot_id: selection.auth_slot_id.clone(),
        materialization_mode: selection.materialization_mode.clone(),
        credential_id: selection.credential_id.clone(),
        credential_revision: selection.credential_revision,
        status: selection.status.clone(),
        credential_share_id: selection.credential_share_id.clone(),
        expires_at: selection.expires_at.clone(),
        protected_env_keys: selection.protected_env.keys().cloned().collect(),
        support_env_keys: selection.support_env.keys().cloned().collect(),
        protected_config_keys: selection.protected_config.keys().cloned().collect(),
        support_config_keys: selection.support_config.keys().cloned().collect(),
        synced_file_paths: selection.synced_file_paths.clone(),
    }
}

pub(super) fn no_selection_kinds(selections: &[AgentAuthSelectionConfig]) -> Vec<String> {
    built_in_registry()
        .into_iter()
        .filter(|kind| {
            let agent_kind = kind.kind.as_str();
            if kind.auth.slots.is_empty() {
                return false;
            }
            !selections.iter().any(|selection| {
                selection.agent_kind == agent_kind
                    && selection
                        .status
                        .as_deref()
                        .map_or(true, |status| matches!(status, "active" | "ready"))
            })
        })
        .map(|descriptor| descriptor.kind.as_str().to_string())
        .collect()
}
