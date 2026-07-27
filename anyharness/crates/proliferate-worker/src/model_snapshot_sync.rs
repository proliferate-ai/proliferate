//! Heartbeat-driven model-snapshot cloud sync (model-catalog.md "Write paths").
//!
//! Replaces the deleted gateway-catalog mirror push. On every successful
//! heartbeat tick:
//!
//! 1. GET the runtime's list of agents (`GET /v1/agents`), then GET each
//!    harness's polled model-snapshot status (`GET /v1/agents/{kind}/model-snapshot`)
//!    over the same narrow local AnyHarness surface `catalog_sync.rs` used
//!    (localhost + optional runtime bearer).
//! 2. Compare each context's `probedAt` against the last-uploaded value held
//!    in memory (this module's state, the `probedAt` analogue of
//!    `catalog_sync`'s ETag cache) — worth at most one redundant upload after
//!    a Worker restart, which the server's soft-versioned write absorbs
//!    idempotently.
//! 3. POST changed contexts to the cloud ingest route
//!    (`POST /v1/cloud/agent-models/{harness}/refresh`) with the Worker's own
//!    bearer; the server resolves the owner from the Worker's sandbox row, so
//!    the payload carries no user identity.
//! 4. Non-fatal like every convergence action: a failure at any step logs and
//!    the next heartbeat tick retries — this module never wedges the loop and
//!    never propagates an error upward.
//!
//! **Uploaded fields are a strict subset of the machine document's entry.**
//! The runtime's status route deliberately never serves `authFingerprint`
//! (model-catalog.md: "never on the wire ... the boolean `stale` plus its
//! reason is the whole client contract") and has no per-context `mechanism`,
//! `installIdentity`, or `lastAttempt` fields either — those stay local
//! diagnostics. What IS uploaded — `probedAt`, `models`, `modes`,
//! `attestation`, `warnings` — is exactly the list model-catalog.md's
//! "Storage" section names for `snapshot_json`, so this is not a narrowed
//! upload; it is the whole of what the wire projection ever carried.
//!
//! **Cloud-sandbox scoped.** The cloud ingest route's `resolve_upload_owner`
//! refuses any worker whose `runtime_kind != "cloud_sandbox"` with a 403
//! (server/proliferate/server/cloud/agent_models/snapshots.py). A desktop
//! worker therefore always gets a 403 here — logged and swallowed like any
//! other push failure, never a special case in this module. The desktop's
//! local-surface document never needed to sync in the first place
//! (model-catalog.md: "Desktop does not sync").

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tracing::{info, warn};

use crate::{
    cloud_client::{CloudClient, IngestModelSnapshotRequest},
    config::WorkerConfig,
    error::WorkerError,
};

/// In-memory state kept across heartbeats: the last successfully-uploaded
/// `probedAt` per (harness_kind, auth_context_id). A restart loses this and
/// re-uploads once — the server's soft-versioned write absorbs the repeat.
pub struct ModelSnapshotSyncState {
    last_pushed: Mutex<HashMap<(String, String), String>>,
}

impl ModelSnapshotSyncState {
    pub fn new() -> Self {
        Self {
            last_pushed: Mutex::new(HashMap::new()),
        }
    }

    fn snapshot(&self) -> HashMap<(String, String), String> {
        self.last_pushed.lock().unwrap().clone()
    }

    fn record_pushed(&self, harness_kind: &str, auth_context_id: &str, probed_at: &str) {
        self.last_pushed.lock().unwrap().insert(
            (harness_kind.to_string(), auth_context_id.to_string()),
            probed_at.to_string(),
        );
    }
}

impl Default for ModelSnapshotSyncState {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Wire shapes read from the runtime (worker-local, minimal) ─────────────

/// One entry of `GET /v1/agents` — only the field this module needs.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeAgentSummary {
    kind: String,
}

/// The subset of `GET /v1/agents/{kind}/model-snapshot`'s response
/// (`ModelSnapshotStatus` in anyharness-lib) this module reads. Deliberately
/// not shared with anyharness-lib's type — the worker binary does not depend
/// on anyharness-lib, mirroring how `catalog_sync.rs` declared its own
/// `RuntimeCatalogVersion` rather than importing one.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeModelSnapshotStatus {
    #[serde(default)]
    contexts: Vec<RuntimeContextStatus>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeContextStatus {
    auth_context_id: String,
    /// Absent (`None`) means no entry has ever been probed for this context —
    /// the "skip harnesses with no snapshot" case.
    #[serde(default)]
    probed_at: Option<String>,
    #[serde(default)]
    models: Vec<serde_json::Value>,
    #[serde(default)]
    modes: Vec<serde_json::Value>,
    #[serde(default)]
    attestation: Option<serde_json::Value>,
    #[serde(default)]
    warnings: Vec<String>,
}

// ─── Decision logic (pure, testable) ───────────────────────────────────────

/// One upload this tick should perform.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingPush {
    pub harness_kind: String,
    pub auth_context_id: String,
    pub probed_at: String,
    pub snapshot_json: String,
}

/// Decide which contexts of one harness need an upload this tick: a context
/// with no entry yet (`probed_at: None`) is skipped, and a context whose
/// `probedAt` already matches the last-pushed value is skipped too. Order is
/// the input order, so callers get deterministic push ordering for logging.
fn plan_pushes(
    harness_kind: &str,
    contexts: &[RuntimeContextStatus],
    last_pushed: &HashMap<(String, String), String>,
) -> Vec<PendingPush> {
    contexts
        .iter()
        .filter_map(|context| {
            let probed_at = context.probed_at.as_deref()?;
            let key = (harness_kind.to_string(), context.auth_context_id.clone());
            if last_pushed.get(&key).map(String::as_str) == Some(probed_at) {
                return None;
            }
            let entry = serde_json::json!({
                "probedAt": probed_at,
                "models": context.models,
                "modes": context.modes,
                "attestation": context.attestation,
                "warnings": context.warnings,
            });
            Some(PendingPush {
                harness_kind: harness_kind.to_string(),
                auth_context_id: context.auth_context_id.clone(),
                probed_at: probed_at.to_string(),
                snapshot_json: entry.to_string(),
            })
        })
        .collect()
}

// ─── Execution (async, side-effecting) ─────────────────────────────────────

/// Run the model-snapshot sync flow for one heartbeat tick. Every failure is
/// logged and swallowed — the heartbeat loop must never crash on a sync
/// failure, and a failed push simply retries next tick because `state` is
/// only updated on success.
pub async fn maybe_sync(
    config: &WorkerConfig,
    cloud: &CloudClient,
    worker_token: &str,
    state: &ModelSnapshotSyncState,
) {
    let runtime_bearer = resolve_runtime_bearer_token(config);
    let runtime_base = config.runtime_base_url.trim_end_matches('/');

    let kinds = match list_runtime_agent_kinds(runtime_base, runtime_bearer.as_deref()).await {
        Ok(kinds) => kinds,
        Err(WorkerError::Cloud { status, .. }) if status == reqwest::StatusCode::NOT_FOUND => {
            info!("model snapshot sync: runtime does not support model snapshots (old version)");
            return;
        }
        Err(error) => {
            warn!(?error, "model snapshot sync: failed to list runtime agents");
            return;
        }
    };

    for kind in kinds {
        sync_one_harness(
            cloud,
            worker_token,
            runtime_base,
            runtime_bearer.as_deref(),
            &kind,
            state,
        )
        .await;
    }
}

/// Sync one harness's contexts. Isolated per harness so one harness's
/// failure (a 409 non-owner runtime, a probe never having run yet) never
/// blocks another harness's upload this tick.
async fn sync_one_harness(
    cloud: &CloudClient,
    worker_token: &str,
    runtime_base: &str,
    runtime_bearer: Option<&str>,
    harness_kind: &str,
    state: &ModelSnapshotSyncState,
) {
    let status = match fetch_runtime_status(runtime_base, runtime_bearer, harness_kind).await {
        Ok(status) => status,
        Err(error) => {
            warn!(
                ?error,
                harness_kind, "model snapshot sync: failed to read runtime status"
            );
            return;
        }
    };

    let last_pushed = state.snapshot();
    let pushes = plan_pushes(harness_kind, &status.contexts, &last_pushed);
    for push in pushes {
        let request = IngestModelSnapshotRequest {
            auth_context_id: push.auth_context_id.clone(),
            snapshot_json: push.snapshot_json,
            probed_at: push.probed_at.clone(),
        };
        match cloud
            .ingest_model_snapshot(worker_token, &push.harness_kind, &request)
            .await
        {
            Ok(()) => {
                state.record_pushed(&push.harness_kind, &push.auth_context_id, &push.probed_at);
                info!(
                    harness_kind = %push.harness_kind,
                    auth_context_id = %push.auth_context_id,
                    "model snapshot sync: uploaded changed entry"
                );
            }
            Err(error) => {
                // Not recorded: the next tick's plan_pushes sees the same
                // stale last_pushed value and retries this exact push.
                warn!(
                    ?error,
                    harness_kind = %push.harness_kind,
                    auth_context_id = %push.auth_context_id,
                    "model snapshot sync: cloud upload failed; retrying next tick"
                );
            }
        }
    }
}

/// Resolve the runtime bearer token: config field takes precedence, then
/// `ANYHARNESS_BEARER_TOKEN` env var. Mirrors the deleted `catalog_sync.rs`.
fn resolve_runtime_bearer_token(config: &WorkerConfig) -> Option<String> {
    config.runtime_bearer_token.clone().or_else(|| {
        std::env::var("ANYHARNESS_BEARER_TOKEN")
            .ok()
            .filter(|v| !v.is_empty())
    })
}

/// `GET /v1/agents`: the list of harness kinds this runtime knows about.
async fn list_runtime_agent_kinds(
    runtime_base: &str,
    bearer_token: Option<&str>,
) -> Result<Vec<String>, WorkerError> {
    let client = reqwest::Client::new();
    let mut request = client.get(format!("{runtime_base}/v1/agents"));
    if let Some(token) = bearer_token {
        request = request.header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let response = request.send().await?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(WorkerError::Cloud { status, body });
    }
    let agents: Vec<RuntimeAgentSummary> = response.json().await?;
    Ok(agents.into_iter().map(|agent| agent.kind).collect())
}

/// `GET /v1/agents/{kind}/model-snapshot`: one harness's polled status,
/// including the models/modes lists this sync uploads.
async fn fetch_runtime_status(
    runtime_base: &str,
    bearer_token: Option<&str>,
    harness_kind: &str,
) -> Result<RuntimeModelSnapshotStatus, WorkerError> {
    let client = reqwest::Client::new();
    let mut request = client.get(format!(
        "{runtime_base}/v1/agents/{harness_kind}/model-snapshot"
    ));
    if let Some(token) = bearer_token {
        request = request.header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let response = request.send().await?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(WorkerError::Cloud { status, body });
    }
    Ok(response.json().await?)
}

#[cfg(test)]
#[path = "model_snapshot_sync_tests.rs"]
mod tests;
