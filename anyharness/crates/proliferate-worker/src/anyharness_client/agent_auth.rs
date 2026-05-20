use serde::Deserialize;
use serde_json::Value;

use crate::error::WorkerError;

use super::AnyHarnessClient;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAgentAuthConfigResponse {
    pub applied: bool,
    pub revision: i64,
    pub status: String,
}

impl AnyHarnessClient {
    pub async fn apply_agent_auth_config(
        &self,
        body: &Value,
    ) -> Result<ApplyAgentAuthConfigResponse, WorkerError> {
        let response = self
            .authenticate(
                self.http()
                    .put(format!("{}/v1/agents/auth-config", self.base_url())),
            )
            .json(body)
            .send()
            .await?;
        let parsed = super::sessions::parse_anyharness_response(response).await?;
        if parsed.is_success() {
            serde_json::from_value(parsed.body).map_err(|error| WorkerError::AnyHarness {
                status: parsed.status,
                body: format!("invalid agent auth apply response: {error}"),
            })
        } else {
            Err(WorkerError::AnyHarness {
                status: parsed.status,
                body: parsed.body.to_string(),
            })
        }
    }
}
