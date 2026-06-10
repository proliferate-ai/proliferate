//! AgentAuthService: apply/status/launch-overlay over the encrypted selection
//! store. resolve (load + decrypt) -> decide (overlay_policy) -> materialize
//! (fs effects). Pure rules live in overlay_policy.rs.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyharness_contract::v1::{
    AgentAuthExternalScope, AgentAuthSelectionConfig, AgentAuthSelectionStatus,
};
use serde::{Deserialize, Serialize};

use crate::domains::agents::registry;
use crate::domains::sessions::mcp_bindings::crypto::{
    decrypt_bytes, encrypt_bytes, SessionDataCipher,
};

use super::codex_config::write_codex_config;
use super::overlay_policy::{self, EnvOverlayPlan};
use super::scope::{default_external_scope, scope_key, LOCAL_SCOPE_KEY};
use super::status::{no_selection_kinds, status_response};
use super::store::{AgentAuthConfigRecord, AgentAuthConfigStore};
use super::validation::validate_config_input;

const CLAUDE_CONFIG_DIR_ENV: &str = "CLAUDE_CONFIG_DIR";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentAuthLaunchOverlay {
    pub support_env: std::collections::BTreeMap<String, String>,
    pub protected_env: std::collections::BTreeMap<String, String>,
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

impl std::fmt::Display for AgentAuthLaunchOverlayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthConfigInput {
    pub external_auth_scope: Option<AgentAuthExternalScope>,
    pub revision: i64,
    pub selections: Vec<AgentAuthSelectionConfig>,
}

#[derive(Debug, Clone)]
pub struct AgentAuthConfigApplyOutcome {
    pub applied: bool,
    pub revision: i64,
    pub selection_count: usize,
    pub no_selection_kinds: Vec<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentAuthConfigStatus {
    pub external_auth_scope: Option<AgentAuthExternalScope>,
    pub revision: Option<i64>,
    pub status: String,
    pub selections: Vec<AgentAuthSelectionStatus>,
}

#[derive(Clone)]
pub struct AgentAuthService {
    store: AgentAuthConfigStore,
    cipher: Option<SessionDataCipher>,
    runtime_home: PathBuf,
    apply_lock: Arc<Mutex<()>>,
}

impl AgentAuthService {
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
        mut input: AgentAuthConfigInput,
    ) -> anyhow::Result<AgentAuthConfigApplyOutcome> {
        normalize_legacy_auth_slot_ids(&mut input);
        validate_config_input(&input)?;
        let _guard = self
            .apply_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("agent auth config apply lock poisoned"))?;
        let Some(cipher) = self.cipher.as_ref() else {
            anyhow::bail!("ANYHARNESS_DATA_KEY is required to apply agent auth config");
        };
        let scope = input
            .external_auth_scope
            .clone()
            .unwrap_or_else(default_external_scope);
        let scope_key = scope_key(&scope);
        if let Some(current_revision) = self.store.current_revision(&scope_key)? {
            if current_revision > input.revision {
                return Ok(AgentAuthConfigApplyOutcome {
                    applied: false,
                    revision: current_revision,
                    selection_count: 0,
                    no_selection_kinds: no_selection_kinds(&input.selections),
                    status: "stale".to_string(),
                });
            }
        }
        let plaintext = serde_json::to_vec(&input)?;
        let ciphertext = encrypt_bytes(cipher, &plaintext)?;
        let applied = self
            .store
            .upsert(&scope_key, &scope, input.revision, &ciphertext)?;
        if !applied {
            let current_revision = self
                .store
                .current_revision(&scope_key)?
                .unwrap_or(input.revision);
            return Ok(AgentAuthConfigApplyOutcome {
                applied: false,
                revision: current_revision,
                selection_count: 0,
                no_selection_kinds: no_selection_kinds(&input.selections),
                status: "stale".to_string(),
            });
        }
        Ok(AgentAuthConfigApplyOutcome {
            applied: true,
            revision: input.revision,
            selection_count: input.selections.len(),
            no_selection_kinds: no_selection_kinds(&input.selections),
            status: "applied".to_string(),
        })
    }

    pub fn status(&self) -> anyhow::Result<AgentAuthConfigStatus> {
        let Some(record) = self.store.latest()? else {
            return Ok(AgentAuthConfigStatus {
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

    /// resolve (load + decrypt) -> decide (overlay_policy::plan) -> materialize.
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
        let decrypted = match &record {
            Some(record) => Some((record.revision, self.decrypt_record(record)?)),
            None => None,
        };
        let plan = overlay_policy::plan(
            agent_kind,
            scope,
            required_revision,
            decrypted.as_ref().map(|(revision, config)| (*revision, config)),
            chrono::Utc::now(),
        )?;
        self.materialize(plan)
    }

    /// The effects the pure plan is not allowed to perform.
    fn materialize(
        &self,
        plan: EnvOverlayPlan,
    ) -> Result<AgentAuthLaunchOverlay, AgentAuthLaunchOverlayError> {
        let EnvOverlayPlan {
            mut support_env,
            mut protected_env,
            needs_claude_gateway_dir,
            codex,
        } = plan;
        if needs_claude_gateway_dir {
            let config_dir = self.claude_gateway_config_dir();
            std::fs::create_dir_all(&config_dir).map_err(|error| {
                anyhow::anyhow!(
                    "failed to create Claude gateway config dir {}: {error}",
                    config_dir.display()
                )
            })?;
            support_env.insert(
                CLAUDE_CONFIG_DIR_ENV.to_string(),
                config_dir.to_string_lossy().into_owned(),
            );
        }
        if let Some(codex) = codex {
            write_codex_config(
                &self.codex_home_dir(),
                &codex.config,
                codex.api_key.as_deref(),
            )?;
            protected_env.insert(
                "CODEX_HOME".to_string(),
                self.codex_home_dir().to_string_lossy().into_owned(),
            );
        }
        Ok(AgentAuthLaunchOverlay {
            support_env,
            protected_env,
        })
    }

    fn decrypt_record(
        &self,
        record: &AgentAuthConfigRecord,
    ) -> anyhow::Result<AgentAuthConfigInput> {
        let Some(cipher) = self.cipher.as_ref() else {
            anyhow::bail!("ANYHARNESS_DATA_KEY is required to read agent auth config");
        };
        let plaintext = decrypt_bytes(cipher, &record.config_ciphertext)?;
        let mut config: AgentAuthConfigInput = serde_json::from_slice(&plaintext)?;
        normalize_legacy_auth_slot_ids(&mut config);
        validate_config_input(&config)?;
        Ok(config)
    }

    fn codex_home_dir(&self) -> PathBuf {
        self.runtime_home.join("agent-auth").join("codex")
    }

    fn claude_gateway_config_dir(&self) -> PathBuf {
        self.runtime_home.join("agent-auth").join("claude-gateway")
    }
}

fn normalize_legacy_auth_slot_ids(input: &mut AgentAuthConfigInput) {
    for selection in &mut input.selections {
        if !selection.auth_slot_id.trim().is_empty() {
            continue;
        }
        let Some(descriptor) = registry::descriptor(&selection.agent_kind) else {
            continue;
        };
        if descriptor.auth.slots.len() != 1 {
            continue;
        }
        selection.auth_slot_id = descriptor.auth.slots[0].id.clone();
    }
}
