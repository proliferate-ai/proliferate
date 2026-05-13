pub mod auth;
pub mod commands;
pub mod events;
pub mod heartbeat;
pub mod inventory;
pub mod updates;

use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::config::CloudConfig;
use crate::error::{Result, WorkerError};

pub use auth::WorkerAuth;

#[derive(Clone)]
pub struct CloudClient {
    base_url: Url,
    http: reqwest::Client,
    auth: Option<WorkerAuth>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollRequest {
    pub enrollment_token: String,
    pub install_id: String,
    pub worker_version: Option<String>,
    pub anyharness_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollResponse {
    pub target_id: String,
    pub worker_id: String,
    pub worker_token: String,
    pub cloud_base_url: Option<String>,
    pub credential_kind: Option<String>,
}

impl CloudClient {
    pub fn unauthenticated(config: &CloudConfig) -> Self {
        Self {
            base_url: config.base_url.clone(),
            http: reqwest::Client::new(),
            auth: None,
        }
    }

    pub fn authenticated(config: &CloudConfig, auth: WorkerAuth) -> Self {
        Self {
            base_url: config.base_url.clone(),
            http: reqwest::Client::new(),
            auth: Some(auth),
        }
    }

    pub async fn enroll(&self, request: &EnrollRequest) -> Result<EnrollResponse> {
        self.post_json("v1/cloud/worker/enroll", request).await
    }

    async fn post_json<B, T>(&self, path: &str, body: &B) -> Result<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        let url = self.endpoint(path)?;
        let mut request = self.http.post(url).json(body);
        if let Some(auth) = &self.auth {
            request = auth.apply(request);
        }
        let response = request.send().await?;
        decode_response(response).await
    }

    fn endpoint(&self, path: &str) -> Result<Url> {
        Ok(self.base_url.join(path.trim_start_matches('/'))?)
    }
}

async fn decode_response<T: DeserializeOwned>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    if !status.is_success() {
        return Err(cloud_status_error(status, response).await);
    }
    Ok(response.json::<T>().await?)
}

async fn decode_empty(response: reqwest::Response) -> Result<()> {
    let status = response.status();
    if !status.is_success() {
        return Err(cloud_status_error(status, response).await);
    }
    Ok(())
}

async fn cloud_status_error(status: StatusCode, response: reqwest::Response) -> WorkerError {
    let body = response.text().await.unwrap_or_default();
    WorkerError::Cloud(format!(
        "status={} body={}",
        status.as_u16(),
        truncate(&body, 512)
    ))
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        value.to_string()
    } else {
        format!("{}...", value.chars().take(max).collect::<String>())
    }
}
