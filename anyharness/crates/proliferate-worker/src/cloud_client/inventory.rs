use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::inventory::InventoryReport;

use super::CloudClient;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentInventory {
    pub report: InventoryReport,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportRequest {
    pub target_id: String,
    pub worker_id: String,
    #[serde(flatten)]
    pub report: InventoryReport,
    pub report_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportResponse {
    pub accepted: bool,
}

impl CloudClient {
    pub async fn report_inventory(
        &self,
        request: &InventoryReportRequest,
    ) -> Result<InventoryReportResponse> {
        self.post_json("v1/cloud/worker/inventory", request).await
    }
}
