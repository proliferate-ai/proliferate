use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::updates::UpdateStatusReport;

use super::CloudClient;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusRequest {
    pub target_id: String,
    pub worker_id: String,
    pub reports: Vec<UpdateStatusReport>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusResponse {
    pub accepted: bool,
}

impl CloudClient {
    pub async fn report_update_status(
        &self,
        request: &UpdateStatusRequest,
    ) -> Result<UpdateStatusResponse> {
        self.post_json("v1/cloud/worker/update-status", request)
            .await
    }
}
