use anyharness_contract::v1::{PushRevokedJtisRequest, PushRevokedJtisResponse};

use crate::error::WorkerError;

use super::{sessions::parse_anyharness_response, AnyHarnessClient};

impl AnyHarnessClient {
    pub async fn push_revoked_jtis(
        &self,
        jti_hashes: Vec<String>,
        expires_at: i64,
    ) -> Result<PushRevokedJtisResponse, WorkerError> {
        let response = self
            .authenticate(
                self.http()
                    .put(format!("{}/v1/auth/revoked-jtis", self.base_url())),
            )
            .json(&PushRevokedJtisRequest {
                jti_hashes,
                expires_at,
            })
            .send()
            .await?;
        let parsed = parse_anyharness_response(response).await?;
        if parsed.is_success() {
            serde_json::from_value(parsed.body).map_err(|error| WorkerError::AnyHarness {
                status: parsed.status,
                body: format!("invalid revoked-jti response: {error}"),
            })
        } else {
            Err(WorkerError::AnyHarness {
                status: parsed.status,
                body: parsed.body.to_string(),
            })
        }
    }
}
