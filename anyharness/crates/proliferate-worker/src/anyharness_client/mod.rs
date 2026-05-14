pub mod health;
pub mod sessions;

use std::time::Duration;

use reqwest::{Client, RequestBuilder};

use crate::error::WorkerError;

#[derive(Debug, Clone)]
pub struct AnyHarnessClient {
    http: Client,
    base_url: String,
    bearer_token: Option<String>,
}

impl AnyHarnessClient {
    pub fn new(base_url: String, bearer_token: Option<String>) -> Result<Self, WorkerError> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(WorkerError::BuildHttpClient)?;
        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            bearer_token,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn http(&self) -> &Client {
        &self.http
    }

    pub fn authenticate(&self, request: RequestBuilder) -> RequestBuilder {
        if let Some(token) = self
            .bearer_token
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            request.bearer_auth(token)
        } else {
            request
        }
    }
}
