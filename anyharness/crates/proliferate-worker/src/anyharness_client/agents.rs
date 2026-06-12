use serde_json::json;

use crate::error::WorkerError;

use super::sessions::{parse_anyharness_response, AnyHarnessCommandResponse};
use super::AnyHarnessClient;

impl AnyHarnessClient {
    /// Poke the runtime's one reconcile engine (plan-then-apply against pins).
    pub async fn reconcile_agents(
        &self,
        reinstall: bool,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(
                self.http()
                    .post(format!("{}/v1/agents/reconcile", self.base_url())),
            )
            .json(&json!({ "reinstall": reinstall }))
            .send()
            .await?;
        parse_anyharness_response(response).await
    }
}
