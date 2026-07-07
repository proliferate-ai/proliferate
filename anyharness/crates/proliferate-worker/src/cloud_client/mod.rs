pub mod auth;
pub mod heartbeat;

use std::time::Duration;

use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{config::WorkerConfig, error::WorkerError};

#[derive(Clone)]
pub struct CloudClient {
    http: Client,
    base_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollRequest {
    pub enrollment_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub machine_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anyharness_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollResponse {
    pub worker_id: String,
    pub worker_token: String,
    pub heartbeat_interval_seconds: u64,
    #[serde(rename = "integrationGateway")]
    pub integration_gateway: IntegrationGatewayConfig,
}

/// Integration-gateway coordinates handed to the worker on enroll; written to
/// the integration-gateway dotfile for the runtime to consume.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationGatewayConfig {
    pub url: String,
    pub authorization: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    // Self-reported so the server row tracks what actually runs, including
    // right after a self-swap.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anyharness_version: Option<String>,
}

/// Component versions the server pins; self-managed workers converge onto
/// these. Every field is optional so acks from older servers (or future shape
/// changes) never break heartbeating.
#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DesiredVersions {
    #[serde(default)]
    pub worker: Option<String>,
    // Parsed for completeness; the worker only swaps its own binary today.
    // AnyHarness convergence is owned by whoever launches the runtime.
    #[allow(dead_code)]
    #[serde(default)]
    pub anyharness: Option<String>,
    /// The `catalogVersion` string the server currently serves. When this
    /// differs from the runtime's active catalog the worker fetches and
    /// pushes the new document.
    #[serde(default)]
    pub catalog_version: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatResponse {
    pub worker_id: String,
    // The server acknowledges liveness without echoing a status; keep this
    // optional so a minimal ack body still deserializes.
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub server_time: Option<String>,
    // Absent on servers that predate version convergence.
    #[serde(default)]
    pub desired_versions: Option<DesiredVersions>,
}

impl CloudClient {
    pub fn new(config: &WorkerConfig) -> Result<Self, WorkerError> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(WorkerError::BuildHttpClient)?;
        Ok(Self {
            http,
            base_url: config.cloud_base_url.trim_end_matches('/').to_string(),
        })
    }

    pub async fn enroll(&self, request: &EnrollRequest) -> Result<EnrollResponse, WorkerError> {
        let response = self
            .http
            .post(format!("{}/v1/cloud/worker/enroll", self.base_url))
            .json(request)
            .send()
            .await?;
        parse_json_response(response).await
    }

    pub async fn heartbeat(
        &self,
        worker_token: &str,
        request: &HeartbeatRequest,
    ) -> Result<HeartbeatResponse, WorkerError> {
        let response = self
            .http
            .post(format!("{}/v1/cloud/worker/heartbeat", self.base_url))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(request)
            .send()
            .await?;
        parse_json_response(response).await
    }

    /// Fetch a pinned worker artifact via the server's redirect endpoint,
    /// capturing the CDN URL the 302 resolved to. Unauthenticated by design
    /// (the CDN artifacts are public); reqwest follows the 302 to the downloads
    /// CDN. Uses a per-request timeout because a binary download can
    /// legitimately outlive the client's default 30s cap on slow links.
    ///
    /// The resolved URL lets a caller fetch a sibling artifact (the binary's
    /// `.sha256`) from the *same* published directory without re-hitting the
    /// redirect: the server resolves pinned-vs-fallback independently per
    /// request, so a second redirect could straddle a publish and pair the
    /// binary with a checksum from a different version.
    pub async fn download_worker_artifact(
        &self,
        target: &str,
        asset: &str,
    ) -> Result<DownloadedArtifact, WorkerError> {
        let response = self
            .http
            .get(format!(
                "{}/v1/cloud/worker/download/{target}/{asset}",
                self.base_url
            ))
            .timeout(ARTIFACT_DOWNLOAD_TIMEOUT)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(WorkerError::Cloud { status, body });
        }
        // Capture the post-redirect URL before the body consumes the response.
        let resolved_url = response.url().to_string();
        let bytes = response.bytes().await?.to_vec();
        Ok(DownloadedArtifact { bytes, resolved_url })
    }

    /// Fetch an artifact directly from an already-resolved CDN URL (used for
    /// the checksum, whose URL is derived from the binary's resolved location
    /// so the pair is guaranteed to share a directory — and thus a version).
    /// No server redirect, hence no second version-path resolution.
    pub async fn download_from_url(&self, url: &str) -> Result<Vec<u8>, WorkerError> {
        let response = self
            .http
            .get(url)
            .timeout(ARTIFACT_DOWNLOAD_TIMEOUT)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(WorkerError::Cloud { status, body });
        }
        Ok(response.bytes().await?.to_vec())
    }

    /// Fetch the agent catalog document from the cloud server. Sends the
    /// stored ETag (if any) as `If-None-Match`; a 304 means the cached
    /// document is current. Returns `None` on 304, `Some((bytes, etag))` on
    /// 200.
    pub async fn fetch_agent_catalog(
        &self,
        worker_token: &str,
        cached_etag: Option<&str>,
    ) -> Result<Option<CatalogFetchResult>, WorkerError> {
        let mut request = self
            .http
            .get(format!("{}/v1/catalogs/agents", self.base_url))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            );
        if let Some(etag) = cached_etag {
            request = request.header(reqwest::header::IF_NONE_MATCH, etag);
        }
        let response = request.send().await?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(None);
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(WorkerError::Cloud { status, body });
        }
        let etag = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let bytes = response.bytes().await?.to_vec();
        Ok(Some(CatalogFetchResult { bytes, etag }))
    }
}

/// Result of a successful (non-304) catalog fetch from the cloud.
pub struct CatalogFetchResult {
    pub bytes: Vec<u8>,
    pub etag: Option<String>,
}

/// A downloaded worker artifact plus the CDN URL the server's redirect
/// resolved to, so a sibling artifact can be fetched from the same directory.
pub struct DownloadedArtifact {
    pub bytes: Vec<u8>,
    pub resolved_url: String,
}

const ARTIFACT_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);

async fn parse_json_response<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, WorkerError> {
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(WorkerError::Cloud { status, body });
    }
    Ok(response.json().await?)
}

#[cfg(test)]
mod tests {
    use super::{EnrollResponse, HeartbeatResponse};

    #[test]
    fn enroll_response_parses_integration_gateway() {
        let payload = br#"{
            "workerId": "worker",
            "workerToken": "token",
            "heartbeatIntervalSeconds": 30,
            "integrationGateway": {
                "url": "http://127.0.0.1:8300",
                "authorization": "Bearer gw-secret"
            }
        }"#;
        let response = serde_json::from_slice::<EnrollResponse>(payload)
            .expect("enroll response with integrationGateway");
        assert_eq!(response.worker_id, "worker");
        assert_eq!(response.worker_token, "token");
        assert_eq!(response.heartbeat_interval_seconds, 30);
        assert_eq!(response.integration_gateway.url, "http://127.0.0.1:8300");
        assert_eq!(
            response.integration_gateway.authorization,
            "Bearer gw-secret"
        );
    }

    #[test]
    fn heartbeat_response_parses_minimal_ack() {
        // Mirrors an older server's body: workerId + serverTime + interval,
        // no status and no desiredVersions.
        let payload = br#"{
            "workerId": "worker",
            "serverTime": "2026-07-01T00:00:00Z",
            "heartbeatIntervalSeconds": 30
        }"#;
        let response =
            serde_json::from_slice::<HeartbeatResponse>(payload).expect("minimal heartbeat ack");
        assert_eq!(response.worker_id, "worker");
        assert_eq!(response.status, None);
        assert_eq!(
            response.server_time.as_deref(),
            Some("2026-07-01T00:00:00Z")
        );
        assert!(response.desired_versions.is_none());
    }

    #[test]
    fn heartbeat_response_parses_desired_versions() {
        let payload = br#"{
            "workerId": "worker",
            "serverTime": "2026-07-01T00:00:00Z",
            "heartbeatIntervalSeconds": 30,
            "desiredVersions": {"worker": "0.2.16", "anyharness": "0.2.16"}
        }"#;
        let response = serde_json::from_slice::<HeartbeatResponse>(payload)
            .expect("heartbeat ack with desiredVersions");
        let desired = response.desired_versions.expect("desiredVersions present");
        assert_eq!(desired.worker.as_deref(), Some("0.2.16"));
        assert_eq!(desired.anyharness.as_deref(), Some("0.2.16"));
        assert_eq!(desired.catalog_version, None);
    }

    #[test]
    fn heartbeat_response_tolerates_partial_desired_versions() {
        // Future shape changes must never break heartbeating.
        let payload = br#"{
            "workerId": "worker",
            "desiredVersions": {"worker": "0.2.16"}
        }"#;
        let response = serde_json::from_slice::<HeartbeatResponse>(payload)
            .expect("heartbeat ack with partial desiredVersions");
        let desired = response.desired_versions.expect("desiredVersions present");
        assert_eq!(desired.worker.as_deref(), Some("0.2.16"));
        assert_eq!(desired.anyharness, None);
        assert_eq!(desired.catalog_version, None);
    }

    #[test]
    fn heartbeat_response_parses_catalog_version() {
        let payload = br#"{
            "workerId": "worker",
            "desiredVersions": {
                "worker": "0.2.16",
                "anyharness": "0.2.16",
                "catalogVersion": "2026-07-06.1"
            }
        }"#;
        let response = serde_json::from_slice::<HeartbeatResponse>(payload)
            .expect("heartbeat ack with catalogVersion");
        let desired = response.desired_versions.expect("desiredVersions present");
        assert_eq!(
            desired.catalog_version.as_deref(),
            Some("2026-07-06.1")
        );
    }

    #[test]
    fn heartbeat_response_tolerates_absent_catalog_version() {
        // Servers that predate catalog convergence omit the field.
        let payload = br#"{
            "workerId": "worker",
            "desiredVersions": {"worker": "0.2.16", "anyharness": "0.2.16"}
        }"#;
        let response = serde_json::from_slice::<HeartbeatResponse>(payload)
            .expect("heartbeat ack without catalogVersion");
        let desired = response.desired_versions.expect("desiredVersions present");
        assert_eq!(desired.catalog_version, None);
    }

    #[test]
    fn heartbeat_request_serializes_versions_camel_case() {
        let request = super::HeartbeatRequest {
            status: Some("online".to_string()),
            worker_version: Some("0.1.0".to_string()),
            anyharness_version: None,
        };
        let value = serde_json::to_value(&request).expect("serialize heartbeat request");
        assert_eq!(value["status"], "online");
        assert_eq!(value["workerVersion"], "0.1.0");
        // Absent versions are omitted entirely, not sent as null.
        assert!(value.get("anyharnessVersion").is_none());
    }
}
