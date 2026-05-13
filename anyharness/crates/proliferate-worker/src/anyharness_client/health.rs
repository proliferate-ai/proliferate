use anyharness_contract::v1::HealthResponse;

use crate::error::Result;

use super::AnyHarnessClient;

impl AnyHarnessClient {
    pub async fn health(&self) -> Result<HealthResponse> {
        self.get_json("health").await
    }
}
