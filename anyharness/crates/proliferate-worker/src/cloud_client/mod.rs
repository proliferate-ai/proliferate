pub mod auth;
pub mod backfill;
pub mod commands;
pub mod events;
pub mod heartbeat;
pub mod inventory;
pub mod target_config;
pub mod target_git_identity;
pub mod updates;

use std::time::Duration;

use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

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
    pub machine_fingerprint: String,
    pub hostname: Option<String>,
    pub worker_version: Option<String>,
    pub anyharness_version: Option<String>,
    pub supervisor_version: Option<String>,
    pub inventory: InventoryPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollResponse {
    pub target_id: String,
    pub worker_id: String,
    pub worker_token: String,
    pub heartbeat_interval_seconds: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatRequest {
    pub status: String,
    pub status_detail: Option<String>,
    pub worker_version: Option<String>,
    pub anyharness_version: Option<String>,
    pub supervisor_version: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesiredVersions {
    pub should_update: bool,
    pub update_channel: String,
    pub update_generation: i64,
    pub anyharness_version: Option<String>,
    pub worker_version: Option<String>,
    pub supervisor_version: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatResponse {
    pub target_id: String,
    pub worker_id: String,
    pub status: String,
    pub server_time: String,
    pub desired_versions: DesiredVersions,
}

#[derive(Debug, Serialize, Clone)]
pub struct InventoryPayload {
    pub os: Option<String>,
    pub arch: Option<String>,
    pub distro: Option<String>,
    pub shell: Option<String>,
    pub git: Option<Value>,
    pub node: Option<Value>,
    pub python: Option<Value>,
    pub browser: Option<Value>,
    pub capabilities: Option<Value>,
    pub providers: Option<Value>,
    pub mcp: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryRequest {
    #[serde(flatten)]
    pub inventory: InventoryPayload,
    pub status: String,
    pub status_detail: Option<String>,
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

    pub async fn upload_inventory(
        &self,
        worker_token: &str,
        request: &InventoryRequest,
    ) -> Result<(), WorkerError> {
        let response = self
            .http
            .post(format!("{}/v1/cloud/worker/inventory", self.base_url))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(request)
            .send()
            .await?;
        parse_empty_response(response).await
    }
}

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

async fn parse_empty_response(response: reqwest::Response) -> Result<(), WorkerError> {
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(WorkerError::Cloud { status, body });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::HeartbeatResponse;

    #[test]
    fn heartbeat_response_rejects_missing_required_fields() {
        let error = serde_json::from_slice::<HeartbeatResponse>(b"{}")
            .expect_err("missing desiredVersions should fail");
        assert!(error.to_string().contains("targetId"));
    }

    #[test]
    fn heartbeat_response_rejects_missing_desired_versions() {
        let payload = br#"{
            "targetId": "target",
            "workerId": "worker",
            "status": "online",
            "serverTime": "2026-05-14T00:00:00Z"
        }"#;
        let error = serde_json::from_slice::<HeartbeatResponse>(payload)
            .expect_err("missing desiredVersions should fail");
        assert!(error.to_string().contains("desiredVersions"));
    }
}
