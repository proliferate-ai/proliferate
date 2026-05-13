use serde::{Deserialize, Serialize};

use super::CloudClient;
use crate::error::Result;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatRequest {
    pub target_id: String,
    pub worker_id: String,
    pub worker_version: String,
    pub anyharness_reachable: bool,
    pub anyharness_version: Option<String>,
    pub online_status: String,
    pub safe_stop_state: String,
    pub safe_stop_reasons: serde_json::Value,
    pub active_session_count: u32,
    pub active_turn_count: u32,
    pub pending_interaction_count: u32,
    pub active_terminal_count: u32,
    pub active_process_count: u32,
    pub last_activity_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatResponse {
    pub ok: bool,
    pub server_time: Option<String>,
    pub desired_worker_version: Option<String>,
    pub desired_anyharness_version: Option<String>,
}

impl CloudClient {
    pub async fn heartbeat(&self, request: &HeartbeatRequest) -> Result<HeartbeatResponse> {
        self.post_json("v1/cloud/worker/heartbeat", request).await
    }
}
