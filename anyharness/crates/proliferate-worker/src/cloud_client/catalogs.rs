//! Cloud agent-catalog fetch (`GET /v1/catalogs/agents`), ETag-aware.
//!
//! The catalog endpoint is public (no worker bearer token) and the body is
//! kept as raw bytes: the worker is a pipe — it pushes the document into the
//! runtime unmodified (`anyharness_client/catalogs.rs`), where validation
//! and the atomic swap live.

use reqwest::{header, StatusCode};

use crate::error::WorkerError;

use super::CloudClient;

#[derive(Debug)]
pub enum AgentCatalogFetch {
    Fetched {
        body: Vec<u8>,
        etag: Option<String>,
    },
    /// 304 for the supplied `If-None-Match`: the served document is the one
    /// already pushed; nothing to converge.
    NotModified,
}

impl CloudClient {
    pub async fn fetch_agent_catalog(
        &self,
        if_none_match: Option<&str>,
    ) -> Result<AgentCatalogFetch, WorkerError> {
        let mut request = self
            .http
            .get(format!("{}/v1/catalogs/agents", self.base_url));
        if let Some(etag) = if_none_match {
            request = request.header(header::IF_NONE_MATCH, etag);
        }
        let response = request.send().await?;
        if response.status() == StatusCode::NOT_MODIFIED {
            return Ok(AgentCatalogFetch::NotModified);
        }
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(WorkerError::Cloud { status, body });
        }
        let etag = response
            .headers()
            .get(header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = response.bytes().await?.to_vec();
        Ok(AgentCatalogFetch::Fetched { body, etag })
    }
}
