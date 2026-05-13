use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::Result;

use super::AnyHarnessClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareStopRequest {
    pub workspace_id: Option<String>,
    pub force: bool,
}

impl AnyHarnessClient {
    pub async fn runtime_inventory(&self) -> Result<Value> {
        self.get_json("v1/runtime/inventory").await
    }

    pub async fn runtime_activity(&self) -> Result<Value> {
        self.get_json("v1/runtime/activity").await
    }

    pub async fn prepare_stop(&self, request: &PrepareStopRequest) -> Result<Value> {
        self.post_json("v1/runtime/prepare-stop", request).await
    }
}
