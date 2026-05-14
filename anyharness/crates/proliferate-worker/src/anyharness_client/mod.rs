pub mod health;
pub mod sessions;

use std::time::Duration;

use reqwest::Client;

use crate::error::WorkerError;

#[derive(Debug, Clone)]
pub struct AnyHarnessClient {
    http: Client,
    base_url: String,
}

impl AnyHarnessClient {
    pub fn new(base_url: String) -> Result<Self, WorkerError> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(WorkerError::BuildHttpClient)?;
        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn http(&self) -> &Client {
        &self.http
    }
}
