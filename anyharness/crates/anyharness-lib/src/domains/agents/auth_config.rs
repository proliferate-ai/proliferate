use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use anyharness_contract::v1::{
    AgentAuthConfigStatusResponse, AgentAuthExternalScope, AgentAuthSelectionConfig,
    AgentAuthSelectionStatus, ApplyAgentAuthConfigRequest, ApplyAgentAuthConfigResponse,
};
use rusqlite::{params, OptionalExtension};
use serde_json::{Map, Value};

use crate::persistence::Db;
use crate::sessions::mcp_bindings::crypto::{decrypt_bytes, encrypt_bytes, SessionDataCipher};

const LOCAL_SCOPE_KEY: &str = "local:default";
const PROTECTED_ENV_KEYS: &[&str] = &[
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    "CLAUDE_CODE_USE_BEDROCK",
    "CODEX_API_KEY",
    "CODEX_HOME",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentAuthLaunchOverlay {
    pub support_env: BTreeMap<String, String>,
    pub protected_env: BTreeMap<String, String>,
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

    fn upsert(
        &self,
        scope_key: &str,
        scope: &AgentAuthExternalScope,
        revision: i64,
        config_ciphertext: &str,
    ) -> anyhow::Result<()> {
        self.db.with_tx(|conn| {
            conn.execute(
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
                    updated_at = datetime('now')",
                params![
                    scope_key,
                    scope.provider,
                    scope.id,
                    scope.target_id.as_deref(),
                    revision,
                    config_ciphertext,
                ],
            )?;
            Ok(())
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
}

#[derive(Clone)]
pub struct AgentAuthConfigService {
    store: AgentAuthConfigStore,
    cipher: Option<SessionDataCipher>,
    runtime_home: PathBuf,
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
        }
    }

    pub fn apply_config(
        &self,
        request: ApplyAgentAuthConfigRequest,
    ) -> anyhow::Result<ApplyAgentAuthConfigResponse> {
        validate_config_request(&request)?;
        let Some(cipher) = self.cipher.as_ref() else {
            anyhow::bail!("ANYHARNESS_DATA_KEY is required to apply agent auth config");
        };
        self.write_managed_config_files(&request)?;
        let scope = request
            .external_auth_scope
            .clone()
            .unwrap_or_else(default_external_scope);
        let plaintext = serde_json::to_vec(&request)?;
        let ciphertext = encrypt_bytes(cipher, &plaintext)?;
        self.store
            .upsert(&scope_key(&scope), &scope, request.revision, &ciphertext)?;
        Ok(ApplyAgentAuthConfigResponse {
            applied: true,
            revision: request.revision,
            selection_count: request.selections.len(),
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

    pub fn launch_overlay(&self, agent_kind: &str) -> anyhow::Result<AgentAuthLaunchOverlay> {
        let Some(record) = self.store.latest()? else {
            return Ok(AgentAuthLaunchOverlay::default());
        };
        let config = self.decrypt_record(&record)?;
        let Some(selection) = config
            .selections
            .iter()
            .find(|selection| selection.agent_kind == agent_kind)
        else {
            return Ok(AgentAuthLaunchOverlay::default());
        };
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
        validate_env_map(&selection.protected_env)?;
        validate_env_map(&selection.support_env)?;
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
        credential_share_id: selection.credential_share_id.clone(),
        protected_env_keys: selection.protected_env.keys().cloned().collect(),
        support_env_keys: selection.support_env.keys().cloned().collect(),
        protected_config_keys: selection.protected_config.keys().cloned().collect(),
        support_config_keys: selection.support_config.keys().cloned().collect(),
        synced_file_paths: selection.synced_file_paths.clone(),
    }
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
    format!(
        "{}:{}",
        sanitize_scope_part(&scope.provider),
        sanitize_scope_part(&scope.id)
    )
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
mod tests {
    use std::collections::BTreeMap;

    use anyharness_contract::v1::{
        AgentAuthExternalScope, AgentAuthSelectionConfig, ApplyAgentAuthConfigRequest,
    };
    use serde_json::json;

    use crate::persistence::Db;
    use crate::sessions::mcp_bindings::crypto::SessionDataCipher;

    use super::{AgentAuthConfigService, AgentAuthConfigStore};

    fn cipher() -> SessionDataCipher {
        SessionDataCipher::from_env_value("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
            .expect("cipher")
    }

    #[test]
    fn applies_status_without_secret_values() {
        let root = std::env::temp_dir().join(format!(
            "anyharness-agent-auth-config-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let service = AgentAuthConfigService::new(
            AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
            Some(cipher()),
            root,
        );

        service
            .apply_config(ApplyAgentAuthConfigRequest {
                external_auth_scope: Some(AgentAuthExternalScope {
                    provider: "proliferate-cloud".to_string(),
                    id: "profile-1".to_string(),
                    target_id: Some("target-1".to_string()),
                }),
                revision: 3,
                selections: vec![AgentAuthSelectionConfig {
                    agent_kind: "claude".to_string(),
                    materialization_mode: "gateway_env".to_string(),
                    credential_id: "credential-1".to_string(),
                    credential_revision: 2,
                    credential_share_id: None,
                    protected_env: BTreeMap::from([(
                        "ANTHROPIC_CUSTOM_HEADERS".to_string(),
                        "Authorization: Bearer secret".to_string(),
                    )]),
                    support_env: BTreeMap::new(),
                    protected_config: BTreeMap::new(),
                    support_config: BTreeMap::new(),
                    synced_file_paths: Vec::new(),
                }],
            })
            .expect("apply");

        let status = service.status().expect("status");
        assert_eq!(status.revision, Some(3));
        assert_eq!(
            status.selections[0].protected_env_keys,
            vec!["ANTHROPIC_CUSTOM_HEADERS".to_string()]
        );
        let serialized = serde_json::to_string(&status).expect("serialize");
        assert!(!serialized.contains("Bearer secret"));
    }

    #[test]
    fn codex_launch_overlay_sets_managed_codex_home() {
        let root = std::env::temp_dir().join(format!(
            "anyharness-agent-auth-codex-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let service = AgentAuthConfigService::new(
            AgentAuthConfigStore::new(Db::open_in_memory().expect("db")),
            Some(cipher()),
            root.clone(),
        );
        service
            .apply_config(ApplyAgentAuthConfigRequest {
                external_auth_scope: None,
                revision: 1,
                selections: vec![AgentAuthSelectionConfig {
                    agent_kind: "codex".to_string(),
                    materialization_mode: "gateway_env".to_string(),
                    credential_id: "credential-1".to_string(),
                    credential_revision: 1,
                    credential_share_id: None,
                    protected_env: BTreeMap::from([(
                        "CODEX_API_KEY".to_string(),
                        "runtime-token".to_string(),
                    )]),
                    support_env: BTreeMap::new(),
                    protected_config: BTreeMap::from([(
                        "codex".to_string(),
                        json!({
                            "model_provider_id": "proliferate",
                            "model_providers": {
                                "proliferate": {
                                    "name": "Proliferate Gateway",
                                    "base_url": "https://gateway.example/openai/v1",
                                    "env_key": "CODEX_API_KEY",
                                    "wire_api": "responses",
                                    "requires_openai_auth": false
                                }
                            }
                        }),
                    )]),
                    support_config: BTreeMap::new(),
                    synced_file_paths: Vec::new(),
                }],
            })
            .expect("apply");

        let overlay = service.launch_overlay("codex").expect("overlay");
        assert_eq!(
            overlay
                .protected_env
                .get("CODEX_API_KEY")
                .map(String::as_str),
            Some("runtime-token")
        );
        assert_eq!(
            overlay.protected_env.get("CODEX_HOME").map(String::as_str),
            Some(
                root.join("agent-auth")
                    .join("codex")
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert!(root
            .join("agent-auth")
            .join("codex")
            .join("config.toml")
            .exists());
    }
}
