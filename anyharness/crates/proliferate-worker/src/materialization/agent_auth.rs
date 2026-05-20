use std::{collections::BTreeMap, fs, io::ErrorKind, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::WorkerError;

use super::files::{expand_home, materialization_error, safe_join, write_file};

const CLAUDE_ALLOWED_AUTH_FILES: &[&str] = &[".claude/.credentials.json", ".claude.json"];
const CODEX_ALLOWED_AUTH_FILES: &[&str] = &[".codex/auth.json"];
const GEMINI_ALLOWED_AUTH_FILES: &[&str] = &[".gemini/oauth_creds.json", ".gemini/settings.json"];
const OPENCODE_ALLOWED_AUTH_FILES: &[&str] = &[".config/opencode/auth.json"];
const CLAUDE_GATEWAY_PROTECTED_ENV: &[&str] = &[
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
];
const CODEX_GATEWAY_PROTECTED_ENV: &[&str] = &["CODEX_API_KEY", "CODEX_HOME"];
const OPENCODE_GATEWAY_PROTECTED_ENV: &[&str] = &["OPENAI_API_KEY", "OPENAI_BASE_URL"];
const CLAUDE_SYNCED_PROTECTED_ENV: &[&str] = &["ANTHROPIC_API_KEY"];
const GEMINI_SYNCED_PROTECTED_ENV: &[&str] = &[
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
];

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
    pub slot_generation: Option<i64>,
    pub sandbox_profile_id: String,
    pub revision: i64,
    #[serde(default)]
    pub selections: Vec<AgentAuthSelectionPlan>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthSelectionPlan {
    pub agent_kind: String,
    pub materialization_mode: String,
    pub credential_id: String,
    pub credential_revision: i64,
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
    expected_slot_generation: Option<i64>,
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
    if expected_slot_generation.is_some() && plan.slot_generation != expected_slot_generation {
        return Err(materialization_error(format!(
            "agent auth slot generation mismatch: expected {}, got {}",
            expected_slot_generation
                .map(|value| value.to_string())
                .unwrap_or_else(|| "<missing>".to_string()),
            plan.slot_generation
                .map(|value| value.to_string())
                .unwrap_or_else(|| "<missing>".to_string())
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
            applied_cleanup_paths.extend(apply_cleanup_actions(
                allowed_root,
                &selection.agent_kind,
                &synced.cleanup,
            )?);
            let written = write_synced_auth_files(
                allowed_root,
                &selection.agent_kind,
                &synced.files,
                &mut synced_file_paths,
            )?;
            synced_file_count += written;
            protected_env.extend(synced.env_vars.clone());
            let _ = &synced.credential_share_id;
        }

        require_allowed_protected_env(
            &selection.agent_kind,
            &selection.materialization_mode,
            &protected_env,
        )?;
        selections.push(json!({
            "agentKind": selection.agent_kind,
            "materializationMode": selection.materialization_mode,
            "credentialId": selection.credential_id,
            "credentialRevision": selection.credential_revision,
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

fn write_synced_auth_files(
    allowed_root: Option<&Path>,
    agent_kind: &str,
    files: &[AgentAuthSyncedFile],
    written_paths: &mut Vec<String>,
) -> Result<usize, WorkerError> {
    let home = agent_auth_home(allowed_root);
    let mut count = 0;
    for file in files {
        require_allowed_agent_auth_file(agent_kind, &file.relative_path)?;
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
    actions: &[AgentAuthCleanupAction],
) -> Result<Vec<String>, WorkerError> {
    if actions.is_empty() {
        return Ok(Vec::new());
    }
    let home = agent_auth_home(allowed_root);
    let mut destinations = Vec::new();
    for action in actions {
        require_allowed_agent_auth_file(agent_kind, &action.relative_path)?;
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
    relative_path: &str,
) -> Result<(), WorkerError> {
    let allowed = match agent_kind {
        "claude" => CLAUDE_ALLOWED_AUTH_FILES,
        "codex" => CODEX_ALLOWED_AUTH_FILES,
        "gemini" => GEMINI_ALLOWED_AUTH_FILES,
        "opencode" => OPENCODE_ALLOWED_AUTH_FILES,
        _ => {
            return Err(materialization_error(format!(
                "unsupported synced agent auth provider: {agent_kind}"
            )));
        }
    };
    if allowed.contains(&relative_path) {
        return Ok(());
    }
    Err(materialization_error(format!(
        "credential file path {relative_path} is not allowed for agent {agent_kind}"
    )))
}

fn require_allowed_protected_env(
    agent_kind: &str,
    materialization_mode: &str,
    protected_env: &BTreeMap<String, String>,
) -> Result<(), WorkerError> {
    let allowed = match (agent_kind, materialization_mode) {
        ("claude", "gateway_env") => CLAUDE_GATEWAY_PROTECTED_ENV,
        ("codex", "gateway_env") => CODEX_GATEWAY_PROTECTED_ENV,
        ("opencode", "gateway_env") => OPENCODE_GATEWAY_PROTECTED_ENV,
        ("claude", "synced_files") => CLAUDE_SYNCED_PROTECTED_ENV,
        ("gemini", "synced_files") => GEMINI_SYNCED_PROTECTED_ENV,
        ("codex", "synced_files") | ("opencode", "synced_files") => &[],
        _ => {
            return Err(materialization_error(format!(
                "unsupported agent auth protected env policy: {agent_kind}/{materialization_mode}"
            )));
        }
    };
    for key in protected_env.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(materialization_error(format!(
                "protected env key {key} is not allowed for {agent_kind}/{materialization_mode}"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;

    use super::{
        build_anyharness_agent_auth_request, parse_refresh_agent_auth_config_payload,
        AgentAuthMaterializationPlan,
    };

    #[test]
    fn parses_refresh_payload_strictly() {
        let payload = parse_refresh_agent_auth_config_payload(&json!({
            "sandboxProfileId": "profile-1",
            "revision": 4,
            "reason": "selection_changed",
            "forceRestart": false
        }))
        .expect("payload");

        assert_eq!(payload.sandbox_profile_id, "profile-1");
        assert_eq!(payload.revision, 4);
    }

    #[test]
    fn builds_secret_bearing_anyharness_request() {
        let plan: AgentAuthMaterializationPlan = serde_json::from_value(json!({
            "applied": true,
            "targetId": "target-1",
            "sandboxProfileId": "profile-1",
            "revision": 7,
            "selections": [{
                "agentKind": "claude",
                "materializationMode": "gateway_env",
                "credentialId": "credential-1",
                "credentialRevision": 3,
                "credentialShareId": null,
                "gateway": {
                    "protocolFacade": "anthropic",
                    "baseUrls": { "anthropic": "https://gateway.example/anthropic" },
                    "runtimeGrantToken": "grant-token",
                    "expiresAt": "2026-05-18T00:00:00Z",
                    "protectedEnv": {
                        "ANTHROPIC_BASE_URL": "https://gateway.example/anthropic",
                        "ANTHROPIC_CUSTOM_HEADERS": "Authorization: Bearer grant-token"
                    },
                    "supportEnv": {},
                    "protectedConfig": {},
                    "supportConfig": {}
                }
            }]
        }))
        .expect("plan");

        let (request, outcome) =
            build_anyharness_agent_auth_request(None, "profile-1", "target-1", None, 7, &plan)
                .expect("request");

        assert!(outcome.applied);
        assert_eq!(outcome.selection_count, 1);
        assert_eq!(request["revision"], 7);
        assert_eq!(
            request["selections"][0]["protectedEnv"]["ANTHROPIC_BASE_URL"],
            "https://gateway.example/anthropic"
        );
        assert_eq!(
            request["selections"][0]["expiresAt"],
            "2026-05-18T00:00:00Z"
        );
    }

    #[test]
    fn rejects_plan_for_different_profile_or_target() {
        let plan: AgentAuthMaterializationPlan = serde_json::from_value(json!({
            "applied": true,
            "targetId": "target-1",
            "sandboxProfileId": "profile-1",
            "revision": 7,
            "selections": []
        }))
        .expect("plan");

        let profile_error =
            build_anyharness_agent_auth_request(None, "profile-2", "target-1", None, 7, &plan)
                .expect_err("profile mismatch");
        assert!(profile_error
            .to_string()
            .contains("agent auth sandbox profile mismatch"));

        let target_error =
            build_anyharness_agent_auth_request(None, "profile-1", "target-2", None, 7, &plan)
                .expect_err("target mismatch");
        assert!(target_error
            .to_string()
            .contains("agent auth target mismatch"));
    }

    #[test]
    fn rejects_plan_for_different_slot_generation() {
        let plan: AgentAuthMaterializationPlan = serde_json::from_value(json!({
            "applied": true,
            "targetId": "target-1",
            "slotGeneration": 4,
            "sandboxProfileId": "profile-1",
            "revision": 7,
            "selections": []
        }))
        .expect("plan");

        let error =
            build_anyharness_agent_auth_request(None, "profile-1", "target-1", Some(5), 7, &plan)
                .expect_err("slot mismatch");
        assert!(error
            .to_string()
            .contains("agent auth slot generation mismatch"));
    }

    #[test]
    fn applies_synced_auth_cleanup_and_reports_paths() {
        let root = std::env::current_dir()
            .expect("cwd")
            .join("target")
            .join(format!(
                "proliferate-worker-agent-auth-cleanup-{}",
                std::process::id()
            ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".codex")).expect("mkdir");
        fs::write(root.join(".codex/auth.json"), "{}").expect("write auth");
        let plan: AgentAuthMaterializationPlan = serde_json::from_value(json!({
            "applied": true,
            "targetId": "target-1",
            "sandboxProfileId": "profile-1",
            "revision": 7,
            "selections": [{
                "agentKind": "codex",
                "materializationMode": "synced_files",
                "credentialId": "credential-1",
                "credentialRevision": 3,
                "credentialShareId": null,
                "syncedFiles": {
                    "credentialShareId": null,
                    "envVars": {},
                    "files": [],
                    "cleanup": [{
                        "relativePath": ".codex/auth.json",
                        "reason": "credential_revoked"
                    }]
                }
            }]
        }))
        .expect("plan");

        let (_request, outcome) = build_anyharness_agent_auth_request(
            Some(&root),
            "profile-1",
            "target-1",
            None,
            7,
            &plan,
        )
        .expect("request");
        assert_eq!(outcome.applied_cleanup_paths, vec![".codex/auth.json"]);
        assert!(!root.join(".codex/auth.json").exists());
    }
}
