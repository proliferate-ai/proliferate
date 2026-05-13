pub mod contract;
pub mod health;
pub mod runtime;
pub mod sessions;
pub mod stream;
pub mod workspaces;

use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::Serialize;
use url::Url;

use crate::config::AnyHarnessConfig;
use crate::error::{Result, WorkerError};

#[derive(Clone)]
pub struct AnyHarnessClient {
    base_url: Url,
    http: reqwest::Client,
    bearer_token: Option<String>,
}

impl AnyHarnessClient {
    pub fn new(config: &AnyHarnessConfig) -> Self {
        Self {
            base_url: config.base_url.clone(),
            http: reqwest::Client::new(),
            bearer_token: config.bearer_token.clone(),
        }
    }

    async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let mut request = self.http.get(self.endpoint(path)?);
        if let Some(token) = &self.bearer_token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await?;
        decode_response(response).await
    }

    async fn post_json<B, T>(&self, path: &str, body: &B) -> Result<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        let mut request = self.http.post(self.endpoint(path)?).json(body);
        if let Some(token) = &self.bearer_token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await?;
        decode_response(response).await
    }

    pub(crate) fn endpoint(&self, path: &str) -> Result<Url> {
        Ok(self.base_url.join(path.trim_start_matches('/'))?)
    }

    pub(crate) fn apply_auth(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(token) = &self.bearer_token {
            request.bearer_auth(token)
        } else {
            request
        }
    }
}

pub(crate) async fn decode_response<T: DeserializeOwned>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(anyharness_status_error(status, &text));
    }
    Ok(serde_json::from_str::<T>(&text)?)
}

pub(crate) fn anyharness_status_error(status: StatusCode, body: &str) -> WorkerError {
    WorkerError::AnyHarness(format!(
        "status={} body={}",
        status.as_u16(),
        truncate(body, 512)
    ))
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        value.to_string()
    } else {
        format!("{}...", value.chars().take(max).collect::<String>())
    }
}
