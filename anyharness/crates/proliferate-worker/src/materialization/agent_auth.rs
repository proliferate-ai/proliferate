use std::{collections::BTreeMap, fs, io::ErrorKind, path::Path, sync::OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::WorkerError;

use super::files::{expand_home, materialization_error, safe_join, write_file};

const BUNDLED_AGENT_REGISTRY: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../catalogs/agents/v1/registry.json"
));

static AGENT_AUTH_REGISTRY: OnceLock<AgentAuthRegistryDocument> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefreshAgentAuthConfigPayload {
    pub sandbox_profile_id: String,
    pub revision: i64,
    pub reason: String,
    pub force_restart: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthMaterializationPlan {
    #[serde(default = "default_applied")]
    pub applied: bool,
    pub reason: Option<String>,
    pub current_revision: Option<i64>,
    pub target_id: Option<String>,
    pub sandbox_profile_id: String,
    pub revision: i64,
    #[serde(default)]
    pub selections: Vec<AgentAuthSelectionPlan>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthSelectionPlan {
    pub agent_kind: String,
    #[serde(default)]
    pub auth_slot_id: String,
    pub materialization_mode: String,
    pub credential_id: String,
    pub credential_revision: i64,
    pub status: Option<String>,
    pub credential_share_id: Option<String>,
    pub gateway: Option<AgentAuthGatewayConfig>,
    pub synced_files: Option<AgentAuthSyncedFilesConfig>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthGatewayConfig {
    pub protocol_facade: String,
    pub base_urls: BTreeMap<String, String>,
    pub runtime_grant_token: String,
    pub expires_at: String,
    #[serde(default)]
    pub protected_env: BTreeMap<String, String>,
    #[serde(default)]
    pub support_env: BTreeMap<String, String>,
    #[serde(default)]
    pub protected_config: BTreeMap<String, Value>,
    #[serde(default)]
    pub support_config: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthSyncedFilesConfig {
    pub credential_share_id: Option<String>,
    #[serde(default)]
    pub env_vars: BTreeMap<String, String>,
    #[serde(default)]
    pub files: Vec<AgentAuthSyncedFile>,
    #[serde(default)]
    pub cleanup: Vec<AgentAuthCleanupAction>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthSyncedFile {
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthCleanupAction {
    pub relative_path: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct AgentAuthStatusResponse {
    pub sandbox_profile_id: String,
    pub target_id: String,
    pub desired_revision: i64,
    pub applied_revision: Option<i64>,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthMaterializationOutcome {
    pub applied: bool,
    pub reason: Option<String>,
    pub revision: i64,
    pub current_revision: Option<i64>,
    pub selection_count: usize,
    pub synced_file_count: usize,
    pub applied_cleanup_paths: Vec<String>,
}

fn default_applied() -> bool {
    true
}

pub fn parse_refresh_agent_auth_config_payload(
    payload: &Value,
) -> Result<RefreshAgentAuthConfigPayload, WorkerError> {
    serde_json::from_value(payload.clone()).map_err(|error| {
        materialization_error(format!(
            "invalid refresh_agent_auth_config payload: {error}"
        ))
    })
}

pub fn build_anyharness_agent_auth_request(
    allowed_root: Option<&Path>,
    expected_sandbox_profile_id: &str,
    expected_target_id: &str,
    expected_revision: i64,
    plan: &AgentAuthMaterializationPlan,
) -> Result<(Value, AgentAuthMaterializationOutcome), WorkerError> {
    if plan.sandbox_profile_id != expected_sandbox_profile_id {
        return Err(materialization_error(format!(
            "agent auth sandbox profile mismatch: expected {expected_sandbox_profile_id}, got {}",
            plan.sandbox_profile_id
        )));
    }
    if plan.target_id.as_deref() != Some(expected_target_id) {
        return Err(materialization_error(format!(
            "agent auth target mismatch: expected {expected_target_id}, got {}",
            plan.target_id.as_deref().unwrap_or("<missing>")
        )));
    }
    if plan.revision != expected_revision {
        return Err(materialization_error(format!(
            "agent auth revision mismatch: expected {expected_revision}, got {}",
            plan.revision
        )));
    }
    if !plan.applied {
        return Ok((
            json!({}),
            AgentAuthMaterializationOutcome {
                applied: false,
                reason: plan.reason.clone(),
                revision: plan.revision,
                current_revision: plan.current_revision,
                selection_count: 0,
                synced_file_count: 0,
                applied_cleanup_paths: Vec::new(),
            },
        ));
    }

    let mut selections = Vec::new();
    let mut synced_file_count = 0;
    let mut applied_cleanup_paths = Vec::new();
    for selection in &plan.selections {
        let auth_slot_id = resolved_auth_slot_id(&selection.agent_kind, &selection.auth_slot_id)?;
        let mut protected_env = BTreeMap::new();
        let mut support_env = BTreeMap::new();
        let mut protected_config = BTreeMap::new();
        let mut support_config = BTreeMap::new();
        let mut synced_file_paths = Vec::new();
        let mut expires_at = None;

        if let Some(gateway) = &selection.gateway {
            let _ = (&gateway.protocol_facade, &gateway.base_urls);
            expires_at = Some(gateway.expires_at.clone());
            protected_env.extend(gateway.protected_env.clone());
            support_env.extend(gateway.support_env.clone());
            protected_config.extend(gateway.protected_config.clone());
            support_config.extend(gateway.support_config.clone());
            if gateway.runtime_grant_token.trim().is_empty() {
                return Err(materialization_error(format!(
                    "gateway runtime grant token is empty for {}",
                    selection.agent_kind
                )));
            }
        }

        if let Some(synced) = &selection.synced_files {
            protected_env.extend(synced.env_vars.clone());
            let _ = &synced.credential_share_id;
        }

        require_allowed_protected_env(
            &selection.agent_kind,
            &auth_slot_id,
            &selection.materialization_mode,
            &protected_env,
        )?;

        if let Some(synced) = &selection.synced_files {
            applied_cleanup_paths.extend(apply_cleanup_actions(
                allowed_root,
                &selection.agent_kind,
                &auth_slot_id,
                &synced.cleanup,
            )?);
            let written = write_synced_auth_files(
                allowed_root,
                &selection.agent_kind,
                &auth_slot_id,
                &synced.files,
                &mut synced_file_paths,
            )?;
            synced_file_count += written;
        }

        selections.push(json!({
            "agentKind": selection.agent_kind,
            "authSlotId": auth_slot_id,
            "materializationMode": selection.materialization_mode,
            "credentialId": selection.credential_id,
            "credentialRevision": selection.credential_revision,
            "status": selection.status,
            "credentialShareId": selection.credential_share_id,
            "expiresAt": expires_at,
            "protectedEnv": protected_env,
            "supportEnv": support_env,
            "protectedConfig": protected_config,
            "supportConfig": support_config,
            "syncedFilePaths": synced_file_paths,
        }));
    }

    Ok((
        json!({
            "externalAuthScope": {
                "provider": "proliferate-cloud",
                "id": plan.sandbox_profile_id,
                "targetId": plan.target_id,
            },
            "revision": plan.revision,
            "selections": selections,
        }),
        AgentAuthMaterializationOutcome {
            applied: true,
            reason: None,
            revision: plan.revision,
            current_revision: plan.current_revision,
            selection_count: plan.selections.len(),
            synced_file_count,
            applied_cleanup_paths,
        },
    ))
}

fn resolved_auth_slot_id(agent_kind: &str, auth_slot_id: &str) -> Result<String, WorkerError> {
    if !auth_slot_id.trim().is_empty() {
        return Ok(auth_slot_id.to_string());
    }
    default_auth_slot_id(agent_kind).ok_or_else(|| {
        materialization_error(format!(
            "missing agent auth slot for unsupported agent {agent_kind}"
        ))
    })
}

fn default_auth_slot_id(agent_kind: &str) -> Option<String> {
    let registry = AGENT_AUTH_REGISTRY.get_or_init(|| {
        serde_json::from_str(BUNDLED_AGENT_REGISTRY).expect("bundled agent registry must parse")
    });
    let agent = registry
        .agents
        .iter()
        .find(|agent| agent.kind == agent_kind)?;
    agent
        .auth
        .slots
        .iter()
        .find(|slot| slot.required_for_readiness)
        .or_else(|| agent.auth.slots.first())
        .map(|slot| slot.id.clone())
}

fn write_synced_auth_files(
    allowed_root: Option<&Path>,
    agent_kind: &str,
    auth_slot_id: &str,
    files: &[AgentAuthSyncedFile],
    written_paths: &mut Vec<String>,
) -> Result<usize, WorkerError> {
    let home = agent_auth_home(allowed_root);
    let mut count = 0;
    for file in files {
        require_allowed_agent_auth_file(agent_kind, auth_slot_id, &file.relative_path)?;
        let destination = safe_join(&home, &file.relative_path)?;
        write_file(&destination, file.content.as_bytes(), true)?;
        written_paths.push(file.relative_path.clone());
        count += 1;
    }
    Ok(count)
}

fn apply_cleanup_actions(
    allowed_root: Option<&Path>,
    agent_kind: &str,
    auth_slot_id: &str,
    actions: &[AgentAuthCleanupAction],
) -> Result<Vec<String>, WorkerError> {
    if actions.is_empty() {
        return Ok(Vec::new());
    }
    let home = agent_auth_home(allowed_root);
    let mut destinations = Vec::new();
    for action in actions {
        require_allowed_agent_auth_file(agent_kind, auth_slot_id, &action.relative_path)?;
        let destination = safe_join(&home, &action.relative_path)?;
        let _ = &action.reason;
        destinations.push((action.relative_path.clone(), destination));
    }
    let mut applied = Vec::new();
    for (relative_path, destination) in destinations {
        match fs::remove_file(&destination) {
            Ok(()) => applied.push(relative_path),
            Err(error) if error.kind() == ErrorKind::NotFound => applied.push(relative_path),
            Err(error) => {
                return Err(materialization_error(format!(
                    "failed to cleanup agent auth file {relative_path}: {error}"
                )));
            }
        }
    }
    Ok(applied)
}

fn agent_auth_home(allowed_root: Option<&Path>) -> std::path::PathBuf {
    allowed_root
        .map(Path::to_path_buf)
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| expand_home("~"))
}

fn require_allowed_agent_auth_file(
    agent_kind: &str,
    auth_slot_id: &str,
    relative_path: &str,
) -> Result<(), WorkerError> {
    let slot = auth_slot_policy(agent_kind, auth_slot_id)?;
    let allowed = slot.materialization.synced_files.as_ref().ok_or_else(|| {
        materialization_error(format!(
            "synced auth files are not supported for {agent_kind}/{auth_slot_id}"
        ))
    })?;
    if allowed
        .allowed_file_paths
        .iter()
        .any(|allowed_path| allowed_path == relative_path)
    {
        return Ok(());
    }
    Err(materialization_error(format!(
        "credential file path {relative_path} is not allowed for agent auth slot {agent_kind}/{auth_slot_id}"
    )))
}

fn require_allowed_protected_env(
    agent_kind: &str,
    auth_slot_id: &str,
    materialization_mode: &str,
    protected_env: &BTreeMap<String, String>,
) -> Result<(), WorkerError> {
    let slot = auth_slot_policy(agent_kind, auth_slot_id)?;
    let allowed = match materialization_mode {
        "gateway_env" => slot
            .materialization
            .gateway_env
            .as_ref()
            .map(|policy| policy.protected_env_keys.as_slice()),
        "synced_files" => slot
            .materialization
            .synced_files
            .as_ref()
            .map(|policy| policy.protected_env_keys.as_slice()),
        _ => None,
    }
    .ok_or_else(|| {
        materialization_error(format!(
            "unsupported agent auth protected env policy: {agent_kind}/{auth_slot_id}/{materialization_mode}"
        ))
    })?;
    for key in protected_env.keys() {
        if !allowed.iter().any(|allowed_key| allowed_key == key) {
            return Err(materialization_error(format!(
                "protected env key {key} is not allowed for {agent_kind}/{auth_slot_id}/{materialization_mode}"
            )));
        }
    }
    Ok(())
}

fn auth_slot_policy(
    agent_kind: &str,
    auth_slot_id: &str,
) -> Result<&'static AgentAuthRegistrySlot, WorkerError> {
    let registry = AGENT_AUTH_REGISTRY.get_or_init(|| {
        serde_json::from_str(BUNDLED_AGENT_REGISTRY).expect("bundled agent registry must parse")
    });
    registry
        .agents
        .iter()
        .find(|agent| agent.kind == agent_kind)
        .and_then(|agent| agent.auth.slots.iter().find(|slot| slot.id == auth_slot_id))
        .ok_or_else(|| {
            materialization_error(format!(
                "unsupported agent auth slot {agent_kind}/{auth_slot_id}"
            ))
        })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAuthRegistryDocument {
    agents: Vec<AgentAuthRegistryAgent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAuthRegistryAgent {
    kind: String,
    auth: AgentAuthRegistryAuth,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAuthRegistryAuth {
    slots: Vec<AgentAuthRegistrySlot>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAuthRegistrySlot {
    id: String,
    #[serde(default)]
    required_for_readiness: bool,
    #[serde(default)]
    materialization: AgentAuthRegistryMaterialization,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAuthRegistryMaterialization {
    gateway_env: Option<AgentAuthRegistryGatewayEnvMaterialization>,
    synced_files: Option<AgentAuthRegistrySyncedFilesMaterialization>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAuthRegistryGatewayEnvMaterialization {
    #[serde(default)]
    protected_env_keys: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAuthRegistrySyncedFilesMaterialization {
    #[serde(default)]
    protected_env_keys: Vec<String>,
    #[serde(default)]
    allowed_file_paths: Vec<String>,
}

#[cfg(test)]
mod tests;
