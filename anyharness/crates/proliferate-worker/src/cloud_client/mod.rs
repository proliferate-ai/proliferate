pub mod auth;
pub mod backfill;
pub mod commands;
pub mod events;
pub mod heartbeat;
pub mod inventory;
pub mod target_config;
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
    #[serde(default)]
    pub should_update: bool,
    #[serde(default = "default_update_channel")]
    pub update_channel: String,
    #[serde(default)]
    pub anyharness_version: Option<String>,
    #[serde(default)]
    pub worker_version: Option<String>,
    #[serde(default)]
    pub supervisor_version: Option<String>,
}

impl Default for DesiredVersions {
    fn default() -> Self {
        Self {
            should_update: false,
            update_channel: default_update_channel(),
            anyharness_version: None,
            worker_version: None,
            supervisor_version: None,
        }
    }
}

fn default_update_channel() -> String {
    "stable".to_string()
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatResponse {
    #[serde(default)]
    pub target_id: String,
    #[serde(default)]
    pub worker_id: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub server_time: String,
    #[serde(default)]
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
        parse_json_or_default_response(response).await
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

async fn parse_json_or_default_response<T: DeserializeOwned + Default>(
    response: reqwest::Response,
) -> Result<T, WorkerError> {
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(WorkerError::Cloud { status, body });
    }
    let body = response.bytes().await?;
    if body.is_empty() {
        return Ok(T::default());
    }
    Ok(serde_json::from_slice(&body)?)
}

async fn parse_empty_response(response: reqwest::Response) -> Result<(), WorkerError> {
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(WorkerError::Cloud { status, body });
    }
    Ok(())
}
