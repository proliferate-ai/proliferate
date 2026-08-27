//! Runtime valve for the agents domain's headless ACP observation.
//!
//! The launch-options domain owns when and why a probe runs. The live session
//! layer owns ACP process and protocol mechanics. Domain-owned request/result
//! twins keep those live powers private to this one valve.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use super::model::{AgentKind, ResolvedAgent};

pub(crate) struct ProbeOptions {
    pub agent_kind: AgentKind,
    pub resolved: ResolvedAgent,
    pub auth_context: String,
    pub auth_env: BTreeMap<String, String>,
    pub auth_env_remove: Vec<String>,
    pub runtime_home: PathBuf,
    pub workspace_root: Option<PathBuf>,
    pub model_switch_timeout: Duration,
    pub max_models: Option<usize>,
    pub switch_models: bool,
    pub send_test_prompt: bool,
}

#[derive(Debug)]
#[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
pub(crate) struct ProbeAttestation {
    pub name: String,
    pub version: String,
    pub title: Option<String>,
}

#[derive(Debug)]
#[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
pub(crate) struct ProbeNativeCli {
    pub path: String,
    pub version: Option<String>,
}

#[derive(Debug)]
#[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
pub(crate) struct ProbeTrialResult {
    pub model_id: String,
    pub accepted: bool,
    pub name: Option<String>,
    pub config_options: Option<serde_json::Value>,
}

#[derive(Debug)]
#[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
pub(crate) struct ProbePromptResult {
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug)]
pub(crate) struct ProbeModelEntry {
    pub model_id: String,
    pub name: String,
    pub description: Option<String>,
    pub config_options: Option<serde_json::Value>,
}

#[derive(Debug)]
#[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
pub(crate) struct ProbeSnapshot {
    pub probed_at: String,
    pub agent_kind: String,
    pub auth_context: String,
    pub attestation: Option<ProbeAttestation>,
    pub model_source: String,
    pub native_cli: Option<ProbeNativeCli>,
    pub trials: Vec<ProbeTrialResult>,
    pub prompt_result: Option<ProbePromptResult>,
    pub current_model_id: Option<String>,
    pub current_mode_id: Option<String>,
    pub modes: serde_json::Value,
    pub baseline_config_options: serde_json::Value,
    pub models: Vec<ProbeModelEntry>,
    pub warnings: Vec<String>,
}

fn into_live_options(options: ProbeOptions) -> crate::live::sessions::probe::ProbeOptions {
    crate::live::sessions::probe::ProbeOptions {
        agent_kind: options.agent_kind,
        resolved: options.resolved,
        auth_context: options.auth_context,
        auth_env: options.auth_env,
        auth_env_remove: options.auth_env_remove,
        runtime_home: options.runtime_home,
        workspace_root: options.workspace_root,
        model_switch_timeout: options.model_switch_timeout,
        max_models: options.max_models,
        switch_models: options.switch_models,
        send_test_prompt: options.send_test_prompt,
    }
}

impl From<crate::live::sessions::probe::ProbeSnapshot> for ProbeSnapshot {
    fn from(snapshot: crate::live::sessions::probe::ProbeSnapshot) -> Self {
        Self {
            probed_at: snapshot.probed_at,
            agent_kind: snapshot.agent_kind,
            auth_context: snapshot.auth_context,
            attestation: snapshot.attestation.map(|value| ProbeAttestation {
                name: value.name,
                version: value.version,
                title: value.title,
            }),
            model_source: snapshot.model_source,
            native_cli: snapshot.native_cli.map(|value| ProbeNativeCli {
                path: value.path,
                version: value.version,
            }),
            trials: snapshot
                .trials
                .into_iter()
                .map(|value| ProbeTrialResult {
                    model_id: value.model_id,
                    accepted: value.accepted,
                    name: value.name,
                    config_options: value.config_options,
                })
                .collect(),
            prompt_result: snapshot.prompt_result.map(|value| ProbePromptResult {
                ok: value.ok,
                detail: value.detail,
            }),
            current_model_id: snapshot.current_model_id,
            current_mode_id: snapshot.current_mode_id,
            modes: snapshot.modes,
            baseline_config_options: snapshot.baseline_config_options,
            models: snapshot
                .models
                .into_iter()
                .map(|value| ProbeModelEntry {
                    model_id: value.model_id,
                    name: value.name,
                    description: value.description,
                    config_options: value.config_options,
                })
                .collect(),
            warnings: snapshot.warnings,
        }
    }
}

pub(crate) async fn probe_agent(options: ProbeOptions) -> anyhow::Result<ProbeSnapshot> {
    crate::live::sessions::probe::probe_agent(into_live_options(options))
        .await
        .map(ProbeSnapshot::from)
}

#[cfg(test)]
pub(crate) fn spawn_env_for_probe(
    options: ProbeOptions,
    ambient: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    crate::live::sessions::probe::spawn_env_for_options(&into_live_options(options), ambient)
}
