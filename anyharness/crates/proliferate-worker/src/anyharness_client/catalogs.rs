//! Push a cloud-fetched agent catalog document into the runtime
//! (`PUT /v1/catalogs/agents`, `api/http/catalogs.rs`). The body is the raw
//! JSON exactly as fetched; the optional `ETag` header forwards the cloud
//! response's ETag. The runtime validates and atomically swaps
//! (`domains/agents/catalog/sync.rs`); a 400 leaves its active catalog
//! untouched.

use anyharness_contract::v1::ApplyAgentCatalogResponse;
use reqwest::header;

use crate::error::WorkerError;

use super::AnyHarnessClient;

impl AnyHarnessClient {
    pub async fn apply_agent_catalog(
        &self,
        body: Vec<u8>,
        etag: Option<&str>,
    ) -> Result<ApplyAgentCatalogResponse, WorkerError> {
        let mut request = self
            .authenticate(
                self.http()
                    .put(format!("{}/v1/catalogs/agents", self.base_url())),
            )
            .header(header::CONTENT_TYPE, "application/json")
            .body(body);
        if let Some(etag) = etag {
            request = request.header(header::ETAG, etag);
        }
        let response = request.send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(WorkerError::AnyHarness { status, body });
        }
        Ok(response.json().await?)
    }
}
