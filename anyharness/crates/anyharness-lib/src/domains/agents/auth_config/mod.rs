use std::collections::BTreeMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyharness_contract::v1::{
    AgentAuthExternalScope, AgentAuthSelectionConfig, AgentAuthSelectionStatus,
};
use serde::{Deserialize, Serialize};

use crate::domains::agents::model::AuthReadinessPolicy;
use crate::domains::agents::registry::built_in_registry;
use crate::domains::sessions::mcp_bindings::crypto::{
    decrypt_bytes, encrypt_bytes, SessionDataCipher,
};

mod codex_config;
mod launch;
mod scope;
mod status;
mod store;
mod validation;

use self::codex_config::write_codex_config;
use self::launch::{reject_expired_selection, selection_required_error};
use self::scope::{default_external_scope, scope_key, LOCAL_SCOPE_KEY};
use self::status::{no_selection_kinds, status_response};
use self::store::AgentAuthConfigRecord;
pub use self::store::AgentAuthConfigStore;
use self::validation::validate_config_input;

const CLAUDE_CONFIG_DIR_ENV: &str = "CLAUDE_CONFIG_DIR";

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
        self.write_managed_config_files(&input)?;
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
            if agent_requires_launch_auth_selection(agent_kind)
                && (scope.is_some() || required_revision.is_some())
            {
                return Err(selection_required_error(
                    scope.cloned(),
                    agent_kind,
                    "missing",
                ));
            }
            return Ok(AgentAuthLaunchOverlay::default());
        };
        let config = self.decrypt_record(&record)?;
        let selections = config
            .selections
            .iter()
            .filter(|selection| selection.agent_kind == agent_kind)
            .collect::<Vec<_>>();
        if let Some(required_revision) = required_revision {
            if record.revision < required_revision
                && (agent_requires_launch_auth_selection(agent_kind) || !selections.is_empty())
            {
                return Err(selection_required_error(
                    scope.cloned(),
                    agent_kind,
                    "needs_resync",
                ));
            }
        }
        if selections.is_empty() {
            if agent_requires_launch_auth_selection(agent_kind)
                && (scope.is_some() || required_revision.is_some())
            {
                return Err(selection_required_error(
                    scope.cloned(),
                    agent_kind,
                    "missing",
                ));
            }
            return Ok(AgentAuthLaunchOverlay::default());
        }
        let mut support_env = BTreeMap::new();
        let mut protected_env = BTreeMap::new();
        for selection in selections {
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
            support_env.extend(selection.support_env.clone());
            protected_env.extend(selection.protected_env.clone());
            if agent_kind == "claude" && selection.materialization_mode == "gateway_env" {
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
            if agent_kind == "codex" && selection.protected_config.contains_key("codex") {
                protected_env.insert(
                    "CODEX_HOME".to_string(),
                    self.codex_home_dir().to_string_lossy().into_owned(),
                );
            }
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

    fn write_managed_config_files(&self, request: &AgentAuthConfigInput) -> anyhow::Result<()> {
        for selection in &request.selections {
            if selection.agent_kind != "codex" {
                continue;
            }
            let Some(config) = selection.protected_config.get("codex") else {
                continue;
            };
            write_codex_config(
                &self.codex_home_dir(),
                config,
                selection
                    .protected_env
                    .get("OPENAI_API_KEY")
                    .or_else(|| selection.protected_env.get("CODEX_API_KEY"))
                    .map(String::as_str),
            )?;
        }
        Ok(())
    }

    fn codex_home_dir(&self) -> PathBuf {
        self.runtime_home.join("agent-auth").join("codex")
    }

    fn claude_gateway_config_dir(&self) -> PathBuf {
        self.runtime_home.join("agent-auth").join("claude-gateway")
    }
}

fn agent_requires_launch_auth_selection(agent_kind: &str) -> bool {
    built_in_registry()
        .iter()
        .find(|descriptor| descriptor.kind.as_str() == agent_kind)
        .map(|descriptor| match descriptor.auth.readiness_policy {
            AuthReadinessPolicy::AnyRequiredSlot | AuthReadinessPolicy::AllRequiredSlots => {
                descriptor
                    .auth
                    .slots
                    .iter()
                    .any(|slot| slot.required_for_readiness)
            }
            AuthReadinessPolicy::ProviderManaged | AuthReadinessPolicy::None => false,
        })
        .unwrap_or(true)
}

fn normalize_legacy_auth_slot_ids(input: &mut AgentAuthConfigInput) {
    let registry = built_in_registry();
    for selection in &mut input.selections {
        if !selection.auth_slot_id.trim().is_empty() {
            continue;
        }
        let Some(descriptor) = registry
            .iter()
            .find(|descriptor| descriptor.kind.as_str() == selection.agent_kind)
        else {
            continue;
        };
        if descriptor.auth.slots.len() != 1 {
            continue;
        }
        selection.auth_slot_id = descriptor.auth.slots[0].id.clone();
    }
}

#[cfg(test)]
#[path = "../auth_config_claude_tests.rs"]
mod auth_config_claude_tests;

#[cfg(test)]
#[path = "../auth_config_tests.rs"]
mod auth_config_tests;
