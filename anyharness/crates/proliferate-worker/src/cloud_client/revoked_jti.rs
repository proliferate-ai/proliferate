use serde::Deserialize;

use crate::error::WorkerError;

use super::{auth, parse_json_response, CloudClient};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRevokedJtiEntry {
    pub jti_hash: String,
    pub hash_key_id: String,
    pub expires_at: String,
    pub revoked_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRevokedJtisResponse {
    pub revoked_jtis: Vec<WorkerRevokedJtiEntry>,
    pub server_time: String,
    pub next_cursor: String,
    pub has_more: bool,
}

impl CloudClient {
    pub async fn list_revoked_jtis(
        &self,
        worker_token: &str,
        cursor: Option<&str>,
    ) -> Result<WorkerRevokedJtisResponse, WorkerError> {
        let mut request = self
            .http
            .get(format!("{}/v1/cloud/worker/revoked-jtis", self.base_url))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            );
        if let Some(cursor) = cursor.filter(|value| !value.is_empty()) {
            request = request.query(&[("cursor", cursor)]);
        }
        parse_json_response(request.send().await?).await
    }
}
