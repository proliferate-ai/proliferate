//! Target-scoped, monotonic copy of runtime launch-option evidence.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tracing::{info, warn};

use crate::{
    cloud_client::{CloudClient, IngestHarnessLaunchOptionsRequest},
    config::WorkerConfig,
    error::WorkerError,
};

/// The tracing target the sync events are emitted under; tests locate them by
/// target, so the only readers live behind `cfg(test)`.
#[cfg_attr(not(test), allow(dead_code))]
pub const LAUNCH_OPTIONS_SYNC_TARGET: &str = module_path!();

#[derive(Default)]
pub struct LaunchOptionsSyncState {
    revisions: Mutex<HashMap<String, i64>>,
}

impl LaunchOptionsSyncState {
    pub fn new() -> Self {
        Self::default()
    }
    /// Test-only watermark accessor (runtime_tests asserts the push ledger).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn pushed_revisions(&self) -> HashMap<String, i64> {
        self.revisions
            .lock()
            .expect("launch-option sync state poisoned")
            .clone()
    }
}

#[derive(Debug, Deserialize)]
struct RuntimeAgentSummary {
    kind: String,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeHarnessLaunchOptionsResponse {
    harness_kind: String,
    basis_revision: String,
    revision: i64,
    state: String,
    options: Option<serde_json::Value>,
    observed_at: Option<String>,
    probe_attempted_at: String,
    probe_failure_code: Option<String>,
    // Accepted from the runtime and deliberately dropped on re-serialize
    // (skip_serializing): readiness never reaches the control plane. The field
    // exists to make that strip explicit; nothing reads it.
    #[allow(dead_code)]
    #[serde(default, skip_serializing)]
    readiness: Option<serde_json::Value>,
}

pub async fn maybe_sync(
    upload_allowed: bool,
    config: &WorkerConfig,
    cloud: &CloudClient,
    worker_token: &str,
    state: &LaunchOptionsSyncState,
) {
    if !upload_allowed {
        return;
    }
    let bearer = config.runtime_bearer_token.clone().or_else(|| {
        std::env::var("ANYHARNESS_BEARER_TOKEN")
            .ok()
            .filter(|value| !value.is_empty())
    });
    let base = config.runtime_base_url.trim_end_matches('/');
    let kinds = match list_harnesses(base, bearer.as_deref()).await {
        Ok(value) => value,
        Err(error) => {
            warn!(
                ?error,
                "launch-option sync failed to list runtime harnesses"
            );
            return;
        }
    };
    for kind in kinds {
        let payload = match read_state(base, bearer.as_deref(), &kind).await {
            Ok(value) => value,
            Err(error) => {
                warn!(?error, harness = %kind, "launch-option sync failed to read runtime state");
                continue;
            }
        };
        let already = state
            .revisions
            .lock()
            .expect("launch-option sync state poisoned")
            .get(&kind)
            .copied();
        if already.is_some_and(|revision| revision >= payload.revision) {
            continue;
        }
        let payload_json = match serde_json::to_string(&payload) {
            Ok(value) => value,
            Err(error) => {
                warn!(?error, harness = %kind, "launch-option sync failed to encode payload");
                continue;
            }
        };
        let request = IngestHarnessLaunchOptionsRequest {
            source_revision: payload.revision,
            payload_json,
        };
        match cloud
            .ingest_harness_launch_options(worker_token, &kind, &request)
            .await
        {
            Ok(()) => {
                state
                    .revisions
                    .lock()
                    .expect("launch-option sync state poisoned")
                    .insert(kind.clone(), payload.revision);
                info!(harness = %kind, source_revision = payload.revision, "copied launch-option state");
            }
            Err(error) => warn!(?error, harness = %kind, "launch-option sync upload failed"),
        }
    }
}

async fn list_harnesses(base: &str, bearer: Option<&str>) -> Result<Vec<String>, WorkerError> {
    let client = reqwest::Client::new();
    let mut request = client.get(format!("{base}/v1/agents"));
    if let Some(token) = bearer {
        request = request.bearer_auth(token);
    }
    let response = request.send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(WorkerError::Cloud {
            status,
            body: response.text().await.unwrap_or_default(),
        });
    }
    Ok(response
        .json::<Vec<RuntimeAgentSummary>>()
        .await?
        .into_iter()
        .map(|agent| agent.kind)
        .collect())
}

async fn read_state(
    base: &str,
    bearer: Option<&str>,
    kind: &str,
) -> Result<RuntimeHarnessLaunchOptionsResponse, WorkerError> {
    let client = reqwest::Client::new();
    let mut request = client.get(format!("{base}/v1/agents/{kind}/launch-options"));
    if let Some(token) = bearer {
        request = request.bearer_auth(token);
    }
    let response = request.send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(WorkerError::Cloud {
            status,
            body: response.text().await.unwrap_or_default(),
        });
    }
    Ok(response.json().await?)
}
