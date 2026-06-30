use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::WorkerError;

use super::{auth, parse_json_response, CloudClient};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCredentialLeaseRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_lease_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_expires_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCredentialLeaseResponse {
    pub provider: String,
    pub token_kind: String,
    pub access_token: String,
    pub actor_login: Option<String>,
    pub actor_id: Option<String>,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub refresh_after: DateTime<Utc>,
    pub lease_id: String,
}

impl CloudClient {
    pub async fn refresh_github_credentials(
        &self,
        worker_token: &str,
        request: &GitHubCredentialLeaseRequest,
    ) -> Result<GitHubCredentialLeaseResponse, WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/worker/github-credentials/refresh",
                self.base_url
            ))
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
