//! Heartbeat-driven agent catalog convergence.
//!
//! When the heartbeat response carries a `catalogVersion` inside
//! `desiredVersions`, the worker compares it to the runtime's active catalog
//! version (queried via `GET /v1/catalogs/agents/version`). On mismatch:
//!
//! 1. Fetch the full catalog document from the cloud server
//!    (`GET /v1/catalogs/agents`, ETag-aware so steady-state re-fetches are
//!    cheap 304s).
//! 2. Push the raw bytes to the runtime
//!    (`PUT /v1/catalogs/agents`, existing transport bearer auth).
//!
//! `apply_fetched` + the reconcile poke in the runtime do the rest (pin-drift
//! detection, reinstall, etc). Failure is non-fatal: log and retry on the
//! next heartbeat.

use std::sync::Mutex;

use serde::Deserialize;
use tracing::{info, warn};

use crate::{
    cloud_client::{CloudClient, HeartbeatResponse},
    config::WorkerConfig,
    error::WorkerError,
};

/// In-memory state kept across heartbeats for ETag caching and avoiding
/// redundant work.
pub struct CatalogSyncState {
    /// ETag from the last successful cloud catalog fetch; sent as
    /// `If-None-Match` on subsequent fetches so unchanged catalogs are free.
    cached_etag: Mutex<Option<String>>,
}

impl CatalogSyncState {
    pub fn new() -> Self {
        Self {
            cached_etag: Mutex::new(None),
        }
    }
}

/// Response from the runtime's `GET /v1/catalogs/agents/version`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCatalogVersion {
    catalog_version: String,
    #[allow(dead_code)]
    source: String,
}

// ─── Decision logic (pure, testable) ───────────────────────────────────────

/// Decide whether this heartbeat demands a catalog sync. Returns the server's
/// advertised catalog version when the worker should act, `None` otherwise.
pub fn plan(response: &HeartbeatResponse) -> Option<&str> {
    response
        .desired_versions
        .as_ref()?
        .catalog_version
        .as_deref()
        .filter(|v| !v.is_empty())
}

/// Compare the server-advertised version to the runtime's active version.
/// Returns `true` when a fetch-and-push is needed.
pub fn needs_sync(advertised: &str, runtime_version: &str) -> bool {
    advertised != runtime_version
}

// ─── Execution (async, side-effecting) ─────────────────────────────────────

/// Run the catalog sync flow for one heartbeat tick. Errors are logged and
/// swallowed — the heartbeat loop must never crash on a catalog sync failure.
pub async fn maybe_sync(
    config: &WorkerConfig,
    cloud: &CloudClient,
    worker_token: &str,
    response: &HeartbeatResponse,
    state: &CatalogSyncState,
) {
    let Some(advertised) = plan(response) else {
        return;
    };

    let runtime_bearer = resolve_runtime_bearer_token(config);
    let runtime_base = config.runtime_base_url.trim_end_matches('/');

    // 1. Query the runtime for its active catalog version.
    let runtime_version = match query_runtime_version(runtime_base, runtime_bearer.as_deref()).await
    {
        Ok(v) => v,
        Err(WorkerError::Cloud { status, .. })
            if status == reqwest::StatusCode::NOT_FOUND =>
        {
            info!("catalog sync: runtime does not support catalog sync (old version)");
            return;
        }
        Err(error) => {
            warn!(?error, "catalog sync: failed to query runtime catalog version");
            return;
        }
    };

    if !needs_sync(advertised, &runtime_version) {
        return;
    }

    info!(
        advertised,
        runtime_version, "catalog sync: version mismatch, fetching from cloud"
    );

    // 2. Fetch from cloud (ETag-aware).
    let cached_etag = state.cached_etag.lock().unwrap().clone();
    let fetch_result =
        match cloud
            .fetch_agent_catalog(worker_token, cached_etag.as_deref())
            .await
        {
            Ok(Some(result)) => result,
            Ok(None) => {
                // 304: our cached copy is the same the server has — but the
                // runtime is behind. This can happen if a previous push failed.
                // We don't cache the body, so we need to re-fetch without ETag.
                match cloud.fetch_agent_catalog(worker_token, None).await {
                    Ok(Some(result)) => result,
                    Ok(None) => {
                        warn!("catalog sync: unexpected 304 without ETag");
                        return;
                    }
                    Err(error) => {
                        warn!(?error, "catalog sync: cloud fetch failed (retry without etag)");
                        return;
                    }
                }
            }
            Err(error) => {
                warn!(?error, "catalog sync: cloud fetch failed");
                return;
            }
        };

    // 3. Push to runtime.
    if let Err(error) = push_to_runtime(
        runtime_base,
        runtime_bearer.as_deref(),
        &fetch_result.bytes,
        fetch_result.etag.as_deref(),
    )
    .await
    {
        warn!(?error, "catalog sync: failed to push catalog to runtime");
        return;
    }

    // Success: cache the ETag for next time.
    *state.cached_etag.lock().unwrap() = fetch_result.etag.clone();
    info!(
        advertised,
        "catalog sync: successfully pushed catalog to runtime"
    );
}

/// Resolve the runtime bearer token: config field takes precedence, then
/// `ANYHARNESS_BEARER_TOKEN` env var.
fn resolve_runtime_bearer_token(config: &WorkerConfig) -> Option<String> {
    config
        .runtime_bearer_token
        .clone()
        .or_else(|| std::env::var("ANYHARNESS_BEARER_TOKEN").ok().filter(|v| !v.is_empty()))
}

/// Query the runtime's `GET /v1/catalogs/agents/version` endpoint.
async fn query_runtime_version(
    runtime_base: &str,
    bearer_token: Option<&str>,
) -> Result<String, WorkerError> {
    let client = reqwest::Client::new();
    let mut request = client.get(format!("{runtime_base}/v1/catalogs/agents/version"));
    if let Some(token) = bearer_token {
        request = request.header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {token}"),
        );
    }
    let response = request.send().await?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(WorkerError::Cloud { status, body });
    }
    let version_response: RuntimeCatalogVersion = response.json().await?;
    Ok(version_response.catalog_version)
}

/// Push the raw catalog bytes to the runtime's `PUT /v1/catalogs/agents`.
async fn push_to_runtime(
    runtime_base: &str,
    bearer_token: Option<&str>,
    bytes: &[u8],
    etag: Option<&str>,
) -> Result<(), WorkerError> {
    let client = reqwest::Client::new();
    let mut request = client
        .put(format!("{runtime_base}/v1/catalogs/agents"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(bytes.to_vec());
    if let Some(token) = bearer_token {
        request = request.header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {token}"),
        );
    }
    if let Some(etag) = etag {
        request = request.header(reqwest::header::ETAG, etag);
    }
    let response = request.send().await?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(WorkerError::Cloud { status, body });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_client::{DesiredVersions, HeartbeatResponse};

    fn heartbeat_with_catalog_version(version: Option<&str>) -> HeartbeatResponse {
        HeartbeatResponse {
            worker_id: "test-worker".to_string(),
            status: Some("online".to_string()),
            server_time: None,
            desired_versions: Some(DesiredVersions {
                worker: None,
                anyharness: None,
                catalog_version: version.map(str::to_string),
            }),
        }
    }

    #[test]
    fn plan_returns_none_when_no_desired_versions() {
        let response = HeartbeatResponse {
            worker_id: "test".to_string(),
            status: None,
            server_time: None,
            desired_versions: None,
        };
        assert_eq!(plan(&response), None);
    }

    #[test]
    fn plan_returns_none_when_catalog_version_absent() {
        let response = heartbeat_with_catalog_version(None);
        assert_eq!(plan(&response), None);
    }

    #[test]
    fn plan_returns_none_when_catalog_version_empty() {
        let response = heartbeat_with_catalog_version(Some(""));
        assert_eq!(plan(&response), None);
    }

    #[test]
    fn plan_returns_version_when_present() {
        let response = heartbeat_with_catalog_version(Some("2026-07-06.1"));
        assert_eq!(plan(&response), Some("2026-07-06.1"));
    }

    #[test]
    fn needs_sync_detects_mismatch() {
        assert!(needs_sync("2026-07-06.1", "2026-07-05.1"));
        assert!(needs_sync("2026-07-05.1", "2026-07-06.1")); // rollback
    }

    #[test]
    fn needs_sync_returns_false_when_equal() {
        assert!(!needs_sync("2026-07-06.1", "2026-07-06.1"));
    }

    #[test]
    fn resolve_runtime_bearer_token_prefers_config_over_env() {
        let config = WorkerConfig {
            cloud_base_url: "https://cloud.test".to_string(),
            enrollment_token: None,
            worker_db_path: "/tmp/worker.sqlite3".into(),
            integration_gateway_home: None,
            heartbeat_interval_seconds: 30,
            self_update_enabled: false,
            anyharness_update_enabled: false,
            anyharness_binary_path: None,
            anyharness_launcher_path: None,
            anyharness_workdir: None,
            runtime_base_url: "http://127.0.0.1:8457".to_string(),
            runtime_bearer_token: Some("from-config".to_string()),
            config_path: None,
        };
        assert_eq!(
            resolve_runtime_bearer_token(&config),
            Some("from-config".to_string())
        );
    }

    #[test]
    fn resolve_runtime_bearer_token_falls_back_to_env() {
        let config = WorkerConfig {
            cloud_base_url: "https://cloud.test".to_string(),
            enrollment_token: None,
            worker_db_path: "/tmp/worker.sqlite3".into(),
            integration_gateway_home: None,
            heartbeat_interval_seconds: 30,
            self_update_enabled: false,
            anyharness_update_enabled: false,
            anyharness_binary_path: None,
            anyharness_launcher_path: None,
            anyharness_workdir: None,
            runtime_base_url: "http://127.0.0.1:8457".to_string(),
            runtime_bearer_token: None,
            config_path: None,
        };
        // Without the env var set, returns None.
        std::env::remove_var("ANYHARNESS_BEARER_TOKEN");
        assert_eq!(resolve_runtime_bearer_token(&config), None);
    }

    /// Verify that a 404 from the runtime (old version without the endpoint)
    /// is distinguishable from other errors via the WorkerError::Cloud variant.
    #[test]
    fn cloud_error_404_is_matchable() {
        let err = WorkerError::Cloud {
            status: reqwest::StatusCode::NOT_FOUND,
            body: "not found".to_string(),
        };
        let is_not_found = matches!(
            &err,
            WorkerError::Cloud { status, .. } if *status == reqwest::StatusCode::NOT_FOUND
        );
        assert!(is_not_found);
    }

    /// Verify that a 500 error does NOT match the 404 pattern.
    #[test]
    fn cloud_error_500_is_not_404() {
        let err = WorkerError::Cloud {
            status: reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            body: "internal".to_string(),
        };
        let is_not_found = matches!(
            &err,
            WorkerError::Cloud { status, .. } if *status == reqwest::StatusCode::NOT_FOUND
        );
        assert!(!is_not_found);
    }
}
