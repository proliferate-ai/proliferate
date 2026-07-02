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
        assert_eq!(response.integration_gateway.authorization, "Bearer gw-secret");
    }

    #[test]
    fn heartbeat_response_parses_minimal_ack() {
        // Mirrors the real server body: workerId + serverTime + interval, no status.
        let payload = br#"{
            "workerId": "worker",
            "serverTime": "2026-07-01T00:00:00Z",
            "heartbeatIntervalSeconds": 30
        }"#;
        let response = serde_json::from_slice::<HeartbeatResponse>(payload)
            .expect("minimal heartbeat ack");
        assert_eq!(response.worker_id, "worker");
        assert_eq!(response.status, None);
        assert_eq!(response.server_time.as_deref(), Some("2026-07-01T00:00:00Z"));
    }
}
