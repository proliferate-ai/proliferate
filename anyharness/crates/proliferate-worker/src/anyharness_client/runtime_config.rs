use serde_json::Value;

use crate::error::WorkerError;

use super::{sessions::parse_anyharness_response, AnyHarnessClient};

impl AnyHarnessClient {
    pub async fn put_runtime_config(
        &self,
        body: &Value,
    ) -> Result<super::sessions::AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(
                self.http()
                    .put(format!("{}/v1/runtime-config", self.base_url())),
            )
            .json(body)
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

    pub async fn prefetch_runtime_config(
        &self,
        include_credentials: bool,
    ) -> Result<super::sessions::AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(
                self.http()
                    .post(format!("{}/v1/runtime-config/prefetch", self.base_url())),
            )
            .json(&serde_json::json!({ "includeCredentials": include_credentials }))
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

    pub async fn list_runtime_config_resolution_requests(
        &self,
    ) -> Result<super::sessions::AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(self.http().get(format!(
                "{}/v1/runtime-config/resolution-requests",
                self.base_url()
            )))
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

    pub async fn fulfill_runtime_config_resolution_request(
        &self,
        request_id: &str,
        body: &Value,
    ) -> Result<super::sessions::AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(self.http().post(format!(
                "{}/v1/runtime-config/resolution-requests/{}/fulfill",
                self.base_url(),
                request_id
            )))
            .json(body)
            .send()
            .await?;
        parse_anyharness_response(response).await
    }
}
