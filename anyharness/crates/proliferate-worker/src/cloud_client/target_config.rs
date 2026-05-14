use serde::Serialize;

use crate::{error::WorkerError, materialization::TargetConfigMaterializationPlan};

use super::{auth, parse_empty_response, parse_json_response, CloudClient};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetConfigStatusRequest {
    pub status: String,
    pub command_id: String,
    pub config_version: i64,
    pub lease_id: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl CloudClient {
    pub async fn fetch_target_config_materialization(
        &self,
        worker_token: &str,
        target_config_id: &str,
        command_id: &str,
        config_version: i64,
        lease_id: &str,
    ) -> Result<TargetConfigMaterializationPlan, WorkerError> {
        let config_version = config_version.to_string();
        let response = self
            .http
            .get(format!(
                "{}/v1/cloud/worker/target-configs/{}/materialization",
                self.base_url, target_config_id
            ))
            .query(&[
                ("command_id", command_id),
                ("config_version", config_version.as_str()),
                ("lease_id", lease_id),
            ])
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .send()
            .await?;
        parse_json_response(response).await
    }

    pub async fn report_target_config_status(
        &self,
        worker_token: &str,
        target_config_id: &str,
        request: &TargetConfigStatusRequest,
    ) -> Result<(), WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/worker/target-configs/{}/status",
                self.base_url, target_config_id
            ))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(request)
            .send()
            .await?;
        parse_empty_response(response).await
    }
}
