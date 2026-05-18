use serde_json::Value;

use crate::error::WorkerError;

use super::AnyHarnessClient;

impl AnyHarnessClient {
    pub async fn apply_agent_auth_config(&self, body: &Value) -> Result<Value, WorkerError> {
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
            Ok(parsed.body)
        } else {
            Err(WorkerError::AnyHarness {
                status: parsed.status,
                body: parsed.body.to_string(),
            })
        }
    }
}
