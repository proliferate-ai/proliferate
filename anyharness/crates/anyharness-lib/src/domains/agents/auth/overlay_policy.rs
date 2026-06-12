//! Pure launch-overlay planning: (selections, scope, revision) -> EnvOverlayPlan.
//! No IO, no &self — the service resolves and materializes; this file only judges.

use std::collections::BTreeMap;

use anyharness_contract::v1::{AgentAuthExternalScope, AgentAuthSelectionConfig};
use chrono::{DateTime, Utc};
use serde_json::Value;

use super::launch::{reject_expired_selection, selection_required_error};
use super::service::{AgentAuthConfigInput, AgentAuthLaunchOverlayError};

/// The decided shape of a launch overlay: env to inject plus the effects the
/// service must perform. Data only — nothing here has happened yet.
#[derive(Debug, Default)]
pub(super) struct EnvOverlayPlan {
    pub support_env: BTreeMap<String, String>,
    pub protected_env: BTreeMap<String, String>,
    pub needs_claude_gateway_dir: bool,
    pub codex: Option<CodexMaterialization>,
}

#[derive(Debug)]
pub(super) struct CodexMaterialization {
    pub config: Value,
    pub api_key: Option<String>,
}

pub(super) fn plan(
    agent_kind: &str,
    scope: Option<&AgentAuthExternalScope>,
    required_revision: Option<i64>,
    decrypted: Option<(i64, &AgentAuthConfigInput)>,
    now: DateTime<Utc>,
) -> Result<EnvOverlayPlan, AgentAuthLaunchOverlayError> {
    let scoped_launch = scope.is_some() || required_revision.is_some();
    let Some((revision, config)) = decrypted else {
        if scoped_launch {
            return Err(selection_required_error(
                scope.cloned(),
                agent_kind,
                "missing",
            ));
        }
        return Ok(EnvOverlayPlan::default());
    };
    let selections = config
        .selections
        .iter()
        .filter(|selection| selection.agent_kind == agent_kind)
        .collect::<Vec<_>>();
    if let Some(required_revision) = required_revision {
        if revision < required_revision {
            return Err(selection_required_error(
                scope.cloned(),
                agent_kind,
                "needs_resync",
            ));
        }
    }
    if selections.is_empty() {
        if scoped_launch {
            return Err(selection_required_error(
                scope.cloned(),
                agent_kind,
                "missing",
            ));
        }
        return Ok(EnvOverlayPlan::default());
    }
    let mut overlay_plan = EnvOverlayPlan::default();
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
        reject_expired_selection(selection, now)
            .map_err(|_| selection_required_error(scope.cloned(), agent_kind, "expired"))?;
        merge_selection_env(
            &mut overlay_plan.support_env,
            &selection.support_env,
            scope,
            agent_kind,
        )?;
        merge_selection_env(
            &mut overlay_plan.protected_env,
            &selection.protected_env,
            scope,
            agent_kind,
        )?;
        if agent_kind == "claude" && selection.materialization_mode == "gateway_env" {
            overlay_plan.needs_claude_gateway_dir = true;
        }
        if agent_kind == "codex" {
            if let Some(config) = selection.protected_config.get("codex") {
                overlay_plan.codex = Some(CodexMaterialization {
                    config: config.clone(),
                    api_key: codex_api_key(selection),
                });
            }
        }
    }
    Ok(overlay_plan)
}

fn codex_api_key(selection: &AgentAuthSelectionConfig) -> Option<String> {
    selection
        .protected_env
        .get("OPENAI_API_KEY")
        .or_else(|| selection.protected_env.get("CODEX_API_KEY"))
        .cloned()
}

fn merge_selection_env(
    target: &mut BTreeMap<String, String>,
    incoming: &BTreeMap<String, String>,
    scope: Option<&AgentAuthExternalScope>,
    agent_kind: &str,
) -> Result<(), AgentAuthLaunchOverlayError> {
    for (key, value) in incoming {
        if let Some(existing) = target.get(key) {
            if existing != value {
                return Err(selection_required_error(
                    scope.cloned(),
                    agent_kind,
                    "conflict",
                ));
            }
            continue;
        }
        target.insert(key.clone(), value.clone());
    }
    Ok(())
}
