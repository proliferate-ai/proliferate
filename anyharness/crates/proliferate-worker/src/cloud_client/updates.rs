use serde::Serialize;

use crate::error::WorkerError;

use super::{auth, parse_empty_response, CloudClient};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusRequest {
    pub status: String,
    pub update_generation: i64,
    pub component: Option<String>,
    pub version: Option<String>,
    pub detail: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl CloudClient {
    pub async fn report_update_status(
        &self,
        worker_token: &str,
        request: &UpdateStatusRequest,
    ) -> Result<(), WorkerError> {
        let response = self
            .http
            .post(format!("{}/v1/cloud/worker/update-status", self.base_url))
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
