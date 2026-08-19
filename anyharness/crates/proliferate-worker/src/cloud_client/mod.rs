pub mod auth;
pub mod heartbeat;

use std::time::Duration;

use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{config::WorkerConfig, error::WorkerError};

#[derive(Clone)]
pub struct CloudClient {
    /// Authenticated requests: never follows redirects (prevents token leak).
    http: Client,
    /// Unauthenticated artifact downloads: follows redirects to CDN.
    http_download: Client,
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
    // Telemetry only (Update Flow ADR, FR-1): last-observed agent catalog
    // version, polled from the runtime's own read-only
    // `GET /v1/catalogs/agents/version` each tick. Never desired state —
    // there is no ack field that ever tells the runtime to change this.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_version: Option<String>,
}

/// Component versions the server pins; self-managed workers converge onto
/// these. Every field is optional so acks from older servers (or future shape
/// changes) never break heartbeating.
#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DesiredVersions {
    #[serde(default)]
    pub worker: Option<String>,
    /// The AnyHarness runtime version the server pins. A sandbox worker with
    /// `anyharness_update_enabled` converges the runtime binary onto it
    /// (download / swap-in-place / relaunch); other workers ignore it. `None`
    /// on an unstamped/old server, which the worker treats as a no-op.
    #[serde(default)]
    pub anyharness: Option<String>,
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
    /// The desired runtime-management topology for this target. `"supervisor_owned"`
    /// (the only non-null value the server emits, and only for flag-enabled
    /// cloud-sandbox targets) tells a Worker to route divergence through the
    /// Supervisor mailbox and, if it is a legacy independent-launch Worker, to
    /// perform the one-time D5 bridge to Supervisor ownership. Absent-tolerant,
    /// exactly like `desired_versions`: older servers omit it and every Worker
    /// treats `None` as today's behavior.
    #[serde(default)]
    pub desired_topology: Option<String>,
    /// D5 bridge inputs the server materializes for an already-provisioned
    /// LEGACY target it is migrating to Supervisor ownership (R9R-002). A legacy
    /// Worker's persisted config has none of the bridge fields, so without this
    /// it could never bridge; the server delivers the Supervisor + supervisor-
    /// owned Worker config TOML and the paths through the live heartbeat channel
    /// so the legacy Worker can materialize them and hand the box off. Absent for
    /// Supervisor-first provisions (their on-disk config already carries the
    /// inputs) and for every non-flag-enabled target.
    #[serde(default)]
    pub supervisor_bridge: Option<SupervisorBridgeInputs>,
    /// The server's verdict on whether THIS Worker may upload an agent-model
    /// snapshot (REL-10). The server owns `runtime_kind`, sandbox existence and
    /// destruction, and the owner the ingest route derives, so it — not the
    /// Worker — decides eligibility; the Worker only consumes the bit as
    /// admission to `launch_options_sync::maybe_sync`.
    ///
    /// `#[serde(default)]` is load-bearing compatibility, not tidiness: a server
    /// that predates this field cannot promise the upload is legal, so its
    /// omission must fail CLOSED to `false` and pause snapshot sync before any
    /// local read or network call. Never treat absent as permission.
    #[serde(default)]
    pub launch_options_upload_allowed: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IngestHarnessLaunchOptionsRequest {
    pub source_revision: i64,
    pub payload_json: String,
}

/// Server-delivered D5 bridge inputs (R9R-002). Carried on the heartbeat ack so
/// an already-provisioned legacy Worker — whose on-disk config predates the
/// supervisor-owned shape — can materialize the Supervisor config AND a
/// supervisor-owned Worker config, then hand the box to a freshly-started
/// Supervisor. All paths are absolute in-sandbox paths the server computes from
/// the target's runtime context.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorBridgeInputs {
    pub supervisor_binary_path: String,
    pub supervisor_config_path: String,
    pub supervisor_config_toml: String,
    /// The supervisor-owned Worker config TOML + its on-disk path. The bridge
    /// overwrites the legacy Worker config with this so the Supervisor's spawned
    /// Worker child is a mailbox writer (not the legacy in-place swapper).
    pub worker_config_path: String,
    pub worker_config_toml: String,
    pub marker_dir: String,
}

impl CloudClient {
    pub fn new(config: &WorkerConfig) -> Result<Self, WorkerError> {
        // Authenticated client: never follows redirects to prevent leaking the
        // Bearer token to a redirect target on a different origin.
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(WorkerError::BuildHttpClient)?;
        // Unauthenticated download client: follows redirects (artifact
        // downloads are public CDN URLs behind a server-issued 302).
        let http_download = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(WorkerError::BuildHttpClient)?;
        Ok(Self {
            http,
            http_download,
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

    pub async fn ingest_harness_launch_options(
        &self,
        worker_token: &str,
        harness_kind: &str,
        request: &IngestHarnessLaunchOptionsRequest,
    ) -> Result<(), WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/harness-launch-options/{harness_kind}",
                self.base_url
            ))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(request)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(WorkerError::Cloud {
                status,
                body: response.text().await.unwrap_or_default(),
            });
        }
        Ok(())
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
            .http_download
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
        Ok(DownloadedArtifact {
            bytes,
            resolved_url,
        })
    }

    /// Fetch a pinned AnyHarness runtime artifact via the server's runtime
    /// redirect endpoint, capturing the CDN URL the 302 resolved to. Parallel
    /// to `download_worker_artifact`: unauthenticated (public CDN), follows the
    /// redirect, and returns the resolved URL so the sibling `.sha256` can be
    /// fetched from the same published directory (hence the same version)
    /// without re-resolving the pinned-vs-fallback path a second time.
    pub async fn download_runtime_artifact(
        &self,
        target: &str,
        asset: &str,
    ) -> Result<DownloadedArtifact, WorkerError> {
        let response = self
            .http_download
            .get(format!(
                "{}/v1/cloud/runtime/download/{target}/{asset}",
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
        let resolved_url = response.url().to_string();
        let bytes = response.bytes().await?.to_vec();
        Ok(DownloadedArtifact {
            bytes,
            resolved_url,
        })
    }

    /// Fetch an artifact directly from an already-resolved CDN URL (used for
    /// the checksum, whose URL is derived from the binary's resolved location
    /// so the pair is guaranteed to share a directory — and thus a version).
    /// No server redirect, hence no second version-path resolution.
    pub async fn download_from_url(&self, url: &str) -> Result<Vec<u8>, WorkerError> {
        let response = self
            .http_download
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

    /// Resolve an artifact's CDN coordinates — the post-redirect URL and its
    /// byte size — WITHOUT downloading the binary body. The supervisor-owned
    /// Worker records these coordinates in an update request; the Supervisor is
    /// the only party that downloads the bytes (boundary: the Worker never
    /// downloads/replaces AnyHarness or itself in the new path).
    ///
    /// `redirect_path` is a server download endpoint (e.g.
    /// `v1/cloud/runtime/download/<target>/<asset>`). The no-redirect client
    /// reads the server's `Location` (the resolved CDN URL, so pinned-vs-fallback
    /// is resolved exactly once), then a `HEAD` on that URL yields
    /// `Content-Length`. A missing/empty `Content-Length` is an error: the
    /// request needs a concrete size the Supervisor re-verifies after download.
    pub async fn resolve_artifact_location(
        &self,
        redirect_path: &str,
    ) -> Result<ArtifactLocation, WorkerError> {
        let redirect = self
            .http
            .get(format!("{}/{}", self.base_url, redirect_path))
            .send()
            .await?;
        let status = redirect.status();
        let url = if status.is_redirection() {
            redirect
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
                .ok_or_else(|| WorkerError::ResolveArtifact {
                    detail: format!("{redirect_path} redirected with no Location header"),
                })?
        } else if status.is_success() {
            // Directly served (no redirect): the endpoint URL is the artifact.
            redirect.url().to_string()
        } else {
            let body = redirect.text().await.unwrap_or_default();
            return Err(WorkerError::Cloud { status, body });
        };
        let head = self
            .http_download
            .head(&url)
            .timeout(ARTIFACT_DOWNLOAD_TIMEOUT)
            .send()
            .await?;
        let head_status = head.status();
        if !head_status.is_success() {
            let body = head.text().await.unwrap_or_default();
            return Err(WorkerError::Cloud {
                status: head_status,
                body,
            });
        }
        let size_bytes = head
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .filter(|size| *size > 0)
            .ok_or_else(|| WorkerError::ResolveArtifact {
                detail: format!("{url} returned no usable Content-Length"),
            })?;
        // Capture the final URL after any HEAD-time redirect so the request's
        // sibling `.sha256` derivation targets the same published directory.
        let resolved_url = head.url().to_string();
        Ok(ArtifactLocation {
            url: resolved_url,
            size_bytes,
        })
    }
}

/// A downloaded worker artifact plus the CDN URL the server's redirect
/// resolved to, so a sibling artifact can be fetched from the same directory.
pub struct DownloadedArtifact {
    pub bytes: Vec<u8>,
    pub resolved_url: String,
}

/// An artifact's CDN coordinates resolved without downloading the body: the
/// post-redirect URL and its `Content-Length`. Used by the supervisor-owned
/// Worker to stamp an update request the Supervisor later downloads.
pub struct ArtifactLocation {
    pub url: String,
    pub size_bytes: u64,
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
mod tests;
