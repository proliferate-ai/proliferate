//! Heartbeat-driven model-snapshot cloud sync (model-catalog.md "Write path").
//!
//! On every successful heartbeat tick:
//!
//! 1. GET the runtime's list of agents (`GET /v1/agents`), then GET each
//!    harness's polled model-snapshot status (`GET /v1/agents/{kind}/model-snapshot`)
//!    over the same narrow local AnyHarness surface `catalog_sync.rs` used
//!    (localhost + optional runtime bearer).
//! 2. Compare each harness's `probedAt` against the last-uploaded value held
//!    in memory (this module's state, the `probedAt` analogue of
//!    `catalog_sync`'s ETag cache) — worth at most one redundant upload after
//!    a Worker restart, which the server's soft-versioned write absorbs
//!    idempotently.
//! 3. POST changed documents to the cloud ingest route
//!    (`POST /v1/cloud/agent-models/{harness}/refresh`) with the Worker's own
//!    bearer; the server resolves the owner from the Worker's sandbox row, so
//!    the payload carries no user identity.
//! 4. Non-fatal like every convergence action: a failure at any step logs and
//!    the next heartbeat tick retries — this module never wedges the loop and
//!    never propagates an error upward.
//!
//! **One observation per harness.** The uploaded `snapshot_json` is the machine
//! document's wire shape — the composed observation plus its provenance fields
//! (`attestation`, `installIdentity`, `stateRevision`) and `lastAttempt` — read
//! off the status route rather than off disk, so the Worker never learns the
//! runtime home's layout. There is no `authContextId`: the per-context keying is
//! superseded by the composed observation.
//!
//! **Cloud-sandbox scoped.** The cloud ingest route refuses any worker whose
//! `runtime_kind != "cloud_sandbox"`. A desktop worker therefore always gets a
//! 403 here — logged and swallowed like any other push failure, never a special
//! case in this module. The desktop's local-surface document never needed to
//! sync in the first place (model-catalog.md: "the desktop's never does").

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
/// `probedAt` per harness kind. A restart loses this and re-uploads once — the
/// server's soft-versioned write absorbs the repeat.
pub struct ModelSnapshotSyncState {
    last_pushed: Mutex<HashMap<String, String>>,
}

impl ModelSnapshotSyncState {
    pub fn new() -> Self {
        Self {
            last_pushed: Mutex::new(HashMap::new()),
        }
    }

    fn snapshot(&self) -> HashMap<String, String> {
        self.last_pushed.lock().unwrap().clone()
    }

    fn record_pushed(&self, harness_kind: &str, probed_at: &str) {
        self.last_pushed
            .lock()
            .unwrap()
            .insert(harness_kind.to_string(), probed_at.to_string());
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
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeModelSnapshotStatus {
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    schema_version: Option<u32>,
    /// Absent (`None`) means no observation has ever been recorded for this
    /// harness — the "skip harnesses with no snapshot" case.
    #[serde(default)]
    probed_at: Option<String>,
    #[serde(default)]
    attestation: Option<serde_json::Value>,
    #[serde(default)]
    install_identity: Option<serde_json::Value>,
    #[serde(default)]
    state_revision: Option<i64>,
    #[serde(default)]
    models: Vec<serde_json::Value>,
    #[serde(default)]
    modes: Vec<serde_json::Value>,
    #[serde(default)]
    warnings: Vec<String>,
    #[serde(default)]
    last_attempt: Option<serde_json::Value>,
}

// ─── Decision logic (pure, testable) ───────────────────────────────────────

/// The upload this tick should perform for one harness, or `None`.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingPush {
    pub harness_kind: String,
    pub probed_at: String,
    pub snapshot_json: String,
}

/// Decide whether one harness needs an upload this tick: a harness with no
/// observation yet (`probed_at: None`) is skipped, and one whose `probedAt`
/// already matches the last-pushed value is skipped too.
fn plan_push(
    harness_kind: &str,
    status: &RuntimeModelSnapshotStatus,
    last_pushed: &HashMap<String, String>,
) -> Option<PendingPush> {
    let probed_at = status.probed_at.as_deref()?;
    if last_pushed.get(harness_kind).map(String::as_str) == Some(probed_at) {
        return None;
    }
    // The machine document's wire shape, reassembled from the status projection
    // (the status route serves the models/modes/provenance fields off the same
    // document read precisely so this uploader exists without disk access).
    let document = serde_json::json!({
        "schemaVersion": status.schema_version.unwrap_or(2),
        "agent": status.agent.as_deref().unwrap_or(harness_kind),
        "probedAt": probed_at,
        "attestation": status.attestation,
        "installIdentity": status.install_identity,
        "stateRevision": status.state_revision.unwrap_or(0),
        "models": status.models,
        "modes": status.modes,
        "warnings": status.warnings,
        "lastAttempt": status.last_attempt,
    });
    Some(PendingPush {
        harness_kind: harness_kind.to_string(),
        probed_at: probed_at.to_string(),
        snapshot_json: document.to_string(),
    })
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

/// Sync one harness's observation. Isolated per harness so one harness's
/// failure (a probe never having run yet, an ingest 4xx) never blocks another
/// harness's upload this tick.
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
    let Some(push) = plan_push(harness_kind, &status, &last_pushed) else {
        return;
    };
    let request = IngestModelSnapshotRequest {
        snapshot_json: push.snapshot_json,
        probed_at: push.probed_at.clone(),
    };
    match cloud
        .ingest_model_snapshot(worker_token, &push.harness_kind, &request)
        .await
    {
        Ok(()) => {
            state.record_pushed(&push.harness_kind, &push.probed_at);
            info!(
                harness_kind = %push.harness_kind,
                "model snapshot sync: uploaded changed observation"
            );
        }
        Err(error) => {
            // Not recorded: the next tick's plan sees the same stale
            // last_pushed value and retries this exact push.
            warn!(
                ?error,
                harness_kind = %push.harness_kind,
                "model snapshot sync: cloud upload failed; retrying next tick"
            );
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
/// including the models/modes lists and provenance fields this sync uploads.
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
