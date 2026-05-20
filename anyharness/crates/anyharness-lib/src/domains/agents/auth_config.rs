use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyharness_contract::v1::{
    AgentAuthConfigStatusResponse, AgentAuthExternalScope, AgentAuthSelectionConfig,
    AgentAuthSelectionStatus, ApplyAgentAuthConfigRequest, ApplyAgentAuthConfigResponse,
};
use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use serde_json::{Map, Value};

use crate::persistence::Db;
use crate::sessions::mcp_bindings::crypto::{decrypt_bytes, encrypt_bytes, SessionDataCipher};

const LOCAL_SCOPE_KEY: &str = "local:default";
const AGENT_AUTH_REQUIRED_AGENT_KINDS: &[&str] = &["claude", "codex", "opencode", "gemini"];
const PROTECTED_ENV_KEYS: &[&str] = &[
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    "CLAUDE_CODE_USE_BEDROCK",
    "CODEX_API_KEY",
    "CODEX_HOME",
    "CURSOR_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
];
const CLAUDE_GATEWAY_PROTECTED_ENV: &[&str] = &[
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
];
const CODEX_GATEWAY_PROTECTED_ENV: &[&str] = &["CODEX_API_KEY", "CODEX_HOME"];
const OPENCODE_GATEWAY_PROTECTED_ENV: &[&str] = &["OPENAI_API_KEY", "OPENAI_BASE_URL"];
const CLAUDE_SYNCED_PROTECTED_ENV: &[&str] = &[];
const GEMINI_SYNCED_PROTECTED_ENV: &[&str] = &[
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentAuthLaunchOverlay {
    pub support_env: BTreeMap<String, String>,
    pub protected_env: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct AgentAuthSelectionRequired {
    pub detail: String,
    pub resolution_scope: Option<AgentAuthExternalScope>,
    pub agent_kind: String,
    pub selection_status: String,
}

#[derive(Debug)]
pub enum AgentAuthLaunchOverlayError {
    SelectionRequired(AgentAuthSelectionRequired),
    Internal(anyhow::Error),
}

impl fmt::Display for AgentAuthLaunchOverlayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SelectionRequired(required) => f.write_str(&required.detail),
            Self::Internal(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for AgentAuthLaunchOverlayError {}

impl From<anyhow::Error> for AgentAuthLaunchOverlayError {
    fn from(error: anyhow::Error) -> Self {
        Self::Internal(error)
    }
}

#[derive(Debug, Clone)]
struct AgentAuthConfigRecord {
    scope_provider: String,
    scope_id: String,
    target_id: Option<String>,
    revision: i64,
    config_ciphertext: String,
}

#[derive(Clone)]
pub struct AgentAuthConfigStore {
    db: Db,
}

impl AgentAuthConfigStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    fn current_revision(&self, scope_key: &str) -> anyhow::Result<Option<i64>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT revision FROM agent_auth_config WHERE scope_key = ?1",
                [scope_key],
                |row| row.get(0),
            )
            .optional()
        })
    }

    fn upsert(
        &self,
        scope_key: &str,
        scope: &AgentAuthExternalScope,
        revision: i64,
        config_ciphertext: &str,
    ) -> anyhow::Result<bool> {
        self.db.with_tx(|conn| {
            let changed = conn.execute(
                "INSERT INTO agent_auth_config (
                    scope_key, scope_provider, scope_id, target_id, revision,
                    config_ciphertext, created_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now')
                 )
                 ON CONFLICT(scope_key) DO UPDATE SET
                    scope_provider = excluded.scope_provider,
                    scope_id = excluded.scope_id,
                    target_id = excluded.target_id,
                    revision = excluded.revision,
                    config_ciphertext = excluded.config_ciphertext,
                    updated_at = datetime('now')
                 WHERE agent_auth_config.revision <= excluded.revision",
                params![
                    scope_key,
                    scope.provider,
                    scope.id,
                    scope.target_id.as_deref(),
                    revision,
                    config_ciphertext,
                ],
            )?;
            Ok(changed > 0)
        })
    }

    fn latest(&self) -> anyhow::Result<Option<AgentAuthConfigRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT scope_provider, scope_id, target_id, revision, config_ciphertext
                 FROM agent_auth_config
                 ORDER BY updated_at DESC
                 LIMIT 1",
                [],
                |row| {
                    Ok(AgentAuthConfigRecord {
                        scope_provider: row.get(0)?,
                        scope_id: row.get(1)?,
                        target_id: row.get(2)?,
                        revision: row.get(3)?,
                        config_ciphertext: row.get(4)?,
                    })
                },
            )
            .optional()
        })
    }

    fn find_by_scope(&self, scope_key: &str) -> anyhow::Result<Option<AgentAuthConfigRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT scope_provider, scope_id, target_id, revision, config_ciphertext
                 FROM agent_auth_config
                 WHERE scope_key = ?1",
                [scope_key],
                |row| {
                    Ok(AgentAuthConfigRecord {
                        scope_provider: row.get(0)?,
                        scope_id: row.get(1)?,
                        target_id: row.get(2)?,
                        revision: row.get(3)?,
                        config_ciphertext: row.get(4)?,
                    })
                },
            )
            .optional()
        })
    }
}

#[derive(Clone)]
pub struct AgentAuthConfigService {
    store: AgentAuthConfigStore,
    cipher: Option<SessionDataCipher>,
    runtime_home: PathBuf,
    apply_lock: Arc<Mutex<()>>,
}

impl AgentAuthConfigService {
    pub fn new(
        store: AgentAuthConfigStore,
        cipher: Option<SessionDataCipher>,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            store,
            cipher,
            runtime_home,
            apply_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn apply_config(
        &self,
        request: ApplyAgentAuthConfigRequest,
    ) -> anyhow::Result<ApplyAgentAuthConfigResponse> {
        validate_config_request(&request)?;
        let _guard = self
            .apply_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("agent auth config apply lock poisoned"))?;
        let Some(cipher) = self.cipher.as_ref() else {
            anyhow::bail!("ANYHARNESS_DATA_KEY is required to apply agent auth config");
        };
        let scope = request
            .external_auth_scope
            .clone()
            .unwrap_or_else(default_external_scope);
        let scope_key = scope_key(&scope);
        if let Some(current_revision) = self.store.current_revision(&scope_key)? {
            if current_revision > request.revision {
                return Ok(ApplyAgentAuthConfigResponse {
                    applied: false,
                    revision: current_revision,
                    selection_count: 0,
                    no_selection_kinds: no_selection_kinds(&request.selections),
                    status: "stale".to_string(),
                });
            }
        }
        self.write_managed_config_files(&request)?;
        let plaintext = serde_json::to_vec(&request)?;
        let ciphertext = encrypt_bytes(cipher, &plaintext)?;
        let applied = self
            .store
            .upsert(&scope_key, &scope, request.revision, &ciphertext)?;
        if !applied {
            let current_revision = self
                .store
                .current_revision(&scope_key)?
                .unwrap_or(request.revision);
            return Ok(ApplyAgentAuthConfigResponse {
                applied: false,
                revision: current_revision,
                selection_count: 0,
                no_selection_kinds: no_selection_kinds(&request.selections),
                status: "stale".to_string(),
            });
        }
        Ok(ApplyAgentAuthConfigResponse {
            applied: true,
            revision: request.revision,
            selection_count: request.selections.len(),
            no_selection_kinds: no_selection_kinds(&request.selections),
            status: "applied".to_string(),
        })
    }

    pub fn status(&self) -> anyhow::Result<AgentAuthConfigStatusResponse> {
        let Some(record) = self.store.latest()? else {
            return Ok(AgentAuthConfigStatusResponse {
                external_auth_scope: None,
                revision: None,
                status: "missing".to_string(),
                selections: Vec::new(),
            });
        };
        let config = self.decrypt_record(&record)?;
        Ok(status_response(
            Some(AgentAuthExternalScope {
                provider: record.scope_provider,
                id: record.scope_id,
                target_id: record.target_id,
            }),
            record.revision,
            &config,
        ))
    }

    pub fn launch_overlay(
        &self,
        agent_kind: &str,
        scope: Option<&AgentAuthExternalScope>,
        required_revision: Option<i64>,
    ) -> Result<AgentAuthLaunchOverlay, AgentAuthLaunchOverlayError> {
        let record = if let Some(scope) = scope {
            let scope_key = scope_key(scope);
            self.store.find_by_scope(&scope_key)?
        } else {
            self.store.find_by_scope(LOCAL_SCOPE_KEY)?
        };
        let Some(record) = record else {
            if scope.is_some() || required_revision.is_some() {
                return Err(selection_required_error(
                    scope.cloned(),
                    agent_kind,
                    "missing",
                ));
            }
            return Ok(AgentAuthLaunchOverlay::default());
        };
        if let Some(required_revision) = required_revision {
            if record.revision < required_revision {
                return Err(selection_required_error(
                    scope.cloned(),
                    agent_kind,
                    "needs_resync",
                ));
            }
        }
        let config = self.decrypt_record(&record)?;
        let Some(selection) = config
            .selections
            .iter()
            .find(|selection| selection.agent_kind == agent_kind)
        else {
            if scope.is_some() || required_revision.is_some() {
                return Err(selection_required_error(
                    scope.cloned(),
                    agent_kind,
                    "missing",
                ));
            }
            return Ok(AgentAuthLaunchOverlay::default());
        };
        if let Some(status) = selection.status.as_deref() {
            if !matches!(status, "active" | "ready") {
                return Err(selection_required_error(
                    scope.cloned(),
                    agent_kind,
                    if status == "needs_resync" {
                        "needs_resync"
                    } else {
                        "invalid"
                    },
                ));
            }
        }
        reject_expired_selection(selection)
            .map_err(|_| selection_required_error(scope.cloned(), agent_kind, "expired"))?;
        let mut protected_env = selection.protected_env.clone();
        if agent_kind == "codex" && selection.protected_config.contains_key("codex") {
            protected_env.insert(
                "CODEX_HOME".to_string(),
                self.codex_home_dir().to_string_lossy().into_owned(),
            );
        }
        Ok(AgentAuthLaunchOverlay {
            support_env: selection.support_env.clone(),
            protected_env,
        })
    }

    fn decrypt_record(
        &self,
        record: &AgentAuthConfigRecord,
    ) -> anyhow::Result<ApplyAgentAuthConfigRequest> {
        let Some(cipher) = self.cipher.as_ref() else {
            anyhow::bail!("ANYHARNESS_DATA_KEY is required to read agent auth config");
        };
        let plaintext = decrypt_bytes(cipher, &record.config_ciphertext)?;
        Ok(serde_json::from_slice(&plaintext)?)
    }

    fn write_managed_config_files(
        &self,
        request: &ApplyAgentAuthConfigRequest,
    ) -> anyhow::Result<()> {
        for selection in &request.selections {
            if selection.agent_kind != "codex" {
                continue;
            }
            let Some(config) = selection.protected_config.get("codex") else {
                continue;
            };
            write_codex_config(&self.codex_home_dir(), config)?;
        }
        Ok(())
    }

    fn codex_home_dir(&self) -> PathBuf {
        self.runtime_home.join("agent-auth").join("codex")
    }
}

fn validate_config_request(request: &ApplyAgentAuthConfigRequest) -> anyhow::Result<()> {
    if request.revision < 0 {
        anyhow::bail!("agent auth config revision must be non-negative");
    }
    for selection in &request.selections {
        if selection.agent_kind.trim().is_empty() {
            anyhow::bail!("agent auth selection agentKind is required");
        }
        if let Some(expires_at) = selection.expires_at.as_deref() {
            DateTime::parse_from_rfc3339(expires_at).map_err(|error| {
                anyhow::anyhow!("agent auth selection expiresAt is invalid: {error}")
            })?;
        }
        validate_env_map(&selection.protected_env)?;
        validate_env_map(&selection.support_env)?;
        validate_protected_env_allowlist(selection)?;
        for key in selection.support_env.keys() {
            if is_protected_env_key(key) {
                anyhow::bail!("agent auth supportEnv cannot set protected key {key}");
            }
        }
    }
    Ok(())
}

fn validate_env_map(env: &BTreeMap<String, String>) -> anyhow::Result<()> {
    for key in env.keys() {
        validate_env_name(key)?;
    }
    Ok(())
}

fn validate_env_name(name: &str) -> anyhow::Result<()> {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        anyhow::bail!("empty environment variable name");
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        anyhow::bail!("environment variable name must start with a letter or underscore");
    }
    if !chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric()) {
        anyhow::bail!("environment variable name contains unsupported characters");
    }
    Ok(())
}

fn validate_protected_env_allowlist(selection: &AgentAuthSelectionConfig) -> anyhow::Result<()> {
    let allowed = match (
        selection.agent_kind.as_str(),
        selection.materialization_mode.as_str(),
    ) {
        ("claude", "gateway_env") => CLAUDE_GATEWAY_PROTECTED_ENV,
        ("codex", "gateway_env") => CODEX_GATEWAY_PROTECTED_ENV,
        ("opencode", "gateway_env") => OPENCODE_GATEWAY_PROTECTED_ENV,
        ("claude", "synced_files") => CLAUDE_SYNCED_PROTECTED_ENV,
        ("gemini", "synced_files") => GEMINI_SYNCED_PROTECTED_ENV,
        ("codex", "synced_files") | ("opencode", "synced_files") => &[],
        _ => {
            anyhow::bail!(
                "agent auth protected env policy is unsupported for {}/{}",
                selection.agent_kind,
                selection.materialization_mode
            );
        }
    };
    for key in selection.protected_env.keys() {
        if !allowed.contains(&key.as_str()) {
            anyhow::bail!(
                "agent auth protectedEnv key {} is not allowed for {}/{}",
                key,
                selection.agent_kind,
                selection.materialization_mode
            );
        }
    }
    Ok(())
}

fn is_protected_env_key(key: &str) -> bool {
    PROTECTED_ENV_KEYS.contains(&key)
}

fn status_response(
    external_scope: Option<AgentAuthExternalScope>,
    revision: i64,
    config: &ApplyAgentAuthConfigRequest,
) -> AgentAuthConfigStatusResponse {
    AgentAuthConfigStatusResponse {
        external_auth_scope: external_scope,
        revision: Some(revision),
        status: "applied".to_string(),
        selections: config.selections.iter().map(selection_status).collect(),
    }
}

fn selection_status(selection: &AgentAuthSelectionConfig) -> AgentAuthSelectionStatus {
    AgentAuthSelectionStatus {
        agent_kind: selection.agent_kind.clone(),
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

fn no_selection_kinds(selections: &[AgentAuthSelectionConfig]) -> Vec<String> {
    AGENT_AUTH_REQUIRED_AGENT_KINDS
        .iter()
        .filter(|kind| {
            !selections.iter().any(|selection| {
                selection.agent_kind == **kind
                    && selection
                        .status
                        .as_deref()
                        .map_or(true, |status| matches!(status, "active" | "ready"))
            })
        })
        .map(|kind| (*kind).to_string())
        .collect()
}

fn selection_required_error(
    scope: Option<AgentAuthExternalScope>,
    agent_kind: &str,
    selection_status: &str,
) -> AgentAuthLaunchOverlayError {
    AgentAuthLaunchOverlayError::SelectionRequired(AgentAuthSelectionRequired {
        detail: format!(
            "Agent auth selection for {agent_kind} is required before launch ({selection_status})."
        ),
        resolution_scope: scope,
        agent_kind: agent_kind.to_string(),
        selection_status: selection_status.to_string(),
    })
}

fn reject_expired_selection(selection: &AgentAuthSelectionConfig) -> anyhow::Result<()> {
    let Some(expires_at) = selection.expires_at.as_deref() else {
        return Ok(());
    };
    let expires_at = DateTime::parse_from_rfc3339(expires_at)
        .map_err(|error| anyhow::anyhow!("agent auth selection expiresAt is invalid: {error}"))?
        .with_timezone(&Utc);
    if expires_at <= Utc::now() {
        anyhow::bail!(
            "agent auth selection for {} expired at {}",
            selection.agent_kind,
            expires_at.to_rfc3339()
        );
    }
    Ok(())
}

fn default_external_scope() -> AgentAuthExternalScope {
    AgentAuthExternalScope {
        provider: "local".to_string(),
        id: "default".to_string(),
        target_id: None,
    }
}

fn scope_key(scope: &AgentAuthExternalScope) -> String {
    if scope.provider == "local" && scope.id == "default" {
        return LOCAL_SCOPE_KEY.to_string();
    }
    let mut key = format!(
        "{}:{}",
        sanitize_scope_part(&scope.provider),
        sanitize_scope_part(&scope.id),
    );
    if let Some(target_id) = scope.target_id.as_deref().filter(|value| !value.is_empty()) {
        key.push_str(":target:");
        key.push_str(&sanitize_scope_part(target_id));
    }
    key
}

fn sanitize_scope_part(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn write_codex_config(codex_home: &PathBuf, config: &Value) -> anyhow::Result<()> {
    let object = config
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("codex protectedConfig must be an object"))?;
    let provider_id = string_value(object, "model_provider_id")
        .ok_or_else(|| anyhow::anyhow!("codex protectedConfig missing model_provider_id"))?;
    let providers = object
        .get("model_providers")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("codex protectedConfig missing model_providers"))?;
    let provider = providers
        .get(provider_id)
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("codex protectedConfig missing selected provider"))?;
    let name = string_value(provider, "name").unwrap_or("Proliferate Gateway");
    let base_url = string_value(provider, "base_url")
        .ok_or_else(|| anyhow::anyhow!("codex provider missing base_url"))?;
    let env_key = string_value(provider, "env_key")
        .ok_or_else(|| anyhow::anyhow!("codex provider missing env_key"))?;
    let wire_api = string_value(provider, "wire_api").unwrap_or("responses");
    let requires_openai_auth = provider
        .get("requires_openai_auth")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let contents = format!(
        "model_provider_id = {}\n\n[model_providers.{}]\nname = {}\nbase_url = {}\nenv_key = {}\nwire_api = {}\nrequires_openai_auth = {}\n",
        toml_string(provider_id),
        provider_id,
        toml_string(name),
        toml_string(base_url),
        toml_string(env_key),
        toml_string(wire_api),
        requires_openai_auth,
    );
    fs::create_dir_all(codex_home)?;
    let path = codex_home.join("config.toml");
    fs::write(&path, contents)?;
    set_private_file_permissions(&path)?;
    Ok(())
}

fn string_value<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str)
}

fn toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &PathBuf) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &PathBuf) -> anyhow::Result<()> {
    Ok(())
}

#[cfg(test)]
#[path = "auth_config_tests.rs"]
mod auth_config_tests;
