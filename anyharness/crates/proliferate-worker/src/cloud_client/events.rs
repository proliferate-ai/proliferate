use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::Result;

use super::CloudClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudEvent {
    pub target_id: String,
    pub workspace_id: Option<String>,
    pub session_id: String,
    pub anyharness_event_id: String,
    pub anyharness_sequence: i64,
    pub event_type: String,
    pub schema_version: u32,
    pub source_kind: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    pub payload_size_bytes: usize,
    pub dedupe_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventBatch {
    pub batch_id: String,
    pub target_id: String,
    pub session_id: String,
    pub seq_start: i64,
    pub seq_end: i64,
    pub events: Vec<CloudEvent>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadEventBatchRequest {
    pub target_id: String,
    pub worker_id: String,
    pub batch: EventBatch,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadEventBatchResponse {
    #[serde(default)]
    pub accepted: bool,
    pub last_ack_seq: Option<i64>,
}

impl CloudClient {
    pub async fn upload_event_batch(
        &self,
        request: &UploadEventBatchRequest,
    ) -> Result<UploadEventBatchResponse> {
        self.post_json("v1/cloud/worker/events/batches", request)
            .await
    }
}
