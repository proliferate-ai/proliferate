use serde::Deserialize;
use tokio::time::Duration;
use tracing::warn;

use crate::{
    cloud_client::{heartbeat, CloudClient, HeartbeatResponse},
    config::WorkerConfig,
    error::WorkerError,
    identity::credentials::WorkerIdentity,
};

pub struct RuntimeHealth {
    pub status: &'static str,
}

pub fn interval(config: &WorkerConfig) -> Duration {
    Duration::from_secs(config.heartbeat_interval_seconds.max(10))
}

/// Send one heartbeat and hand the ack back to the caller: the runtime loop
/// acts on `desiredVersions` (self-update convergence). `anyharness_version` is
/// what the runtime actually runs (a converged swap, else the boot-time
/// export), so the server row tracks it within one interval of a swap.
/// `catalog_version` is polled fresh each tick from the runtime's own
/// read-only version route — telemetry only, mirroring
/// `model_snapshot_sync.rs`'s non-fatal pattern (a failed poll just omits the
/// field this tick, never fails the heartbeat).
pub async fn send_once(
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    config: &WorkerConfig,
    anyharness_version: Option<String>,
) -> Result<HeartbeatResponse, WorkerError> {
    let health = runtime_health();
    let catalog_version = poll_catalog_version(config).await;
    let request = heartbeat::report(health.status, anyharness_version, catalog_version);
    let response = cloud.heartbeat(&identity.worker_token, &request).await?;
    crate::observability::heartbeat_ack(&response);
    Ok(response)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCatalogVersionResponse {
    catalog_version: String,
}

fn resolve_runtime_bearer_token(config: &WorkerConfig) -> Option<String> {
    config.runtime_bearer_token.clone().or_else(|| {
        std::env::var("ANYHARNESS_BEARER_TOKEN")
            .ok()
            .filter(|v| !v.is_empty())
    })
}

/// `GET /v1/catalogs/agents/version`: the ONE read this poll makes. Never
/// retried within a tick, never propagated as an error — a missed poll just
/// means this heartbeat omits `catalog_version`, exactly like a missed
/// model-snapshot sync omits that tick's upload.
async fn poll_catalog_version(config: &WorkerConfig) -> Option<String> {
    let runtime_base = config.runtime_base_url.trim_end_matches('/');
    let bearer_token = resolve_runtime_bearer_token(config);
    let client = reqwest::Client::new();
    let mut request = client.get(format!("{runtime_base}/v1/catalogs/agents/version"));
    if let Some(token) = bearer_token.as_deref() {
        request = request.header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
    }
    match request.send().await {
        Ok(response) if response.status().is_success() => {
            match response.json::<RuntimeCatalogVersionResponse>().await {
                Ok(body) => Some(body.catalog_version),
                Err(error) => {
                    warn!(?error, "heartbeat: failed to parse runtime catalog version");
                    None
                }
            }
        }
        Ok(response) => {
            warn!(
                status = %response.status(),
                "heartbeat: runtime catalog version poll returned a non-success status"
            );
            None
        }
        Err(error) => {
            warn!(?error, "heartbeat: failed to poll runtime catalog version");
            None
        }
    }
}

pub fn runtime_health() -> RuntimeHealth {
    RuntimeHealth { status: "online" }
}
