use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::WorkerError;

use super::{auth, parse_json_response, CloudClient};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerSessionEventEnvelope {
    pub workspace_id: Option<String>,
    pub session_id: String,
    pub seq: i64,
    pub timestamp: Option<String>,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub event: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventBatchRequest {
    pub events: Vec<WorkerSessionEventEnvelope>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionGapRequest {
    pub exposure_id: String,
    pub session_projection_id: String,
    pub session_id: String,
    pub expected_seq: i64,
    pub first_observed_seq: i64,
    pub last_uploaded_seq: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSessionAck {
    pub session_id: String,
    pub last_contiguous_seq: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventBatchResponse {
    pub accepted_events: i64,
    pub duplicate_events: i64,
    pub live_only_events: i64,
    pub session_acks: Vec<EventSessionAck>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionGapResponse {
    pub updated: bool,
}

impl CloudClient {
    pub async fn upload_event_batch(
        &self,
        worker_token: &str,
        request: &EventBatchRequest,
    ) -> Result<EventBatchResponse, WorkerError> {
        let response = self
            .http
            .post(format!("{}/v1/cloud/worker/events/batches", self.base_url))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(request)
            .send()
            .await?;
        parse_json_response(response).await
    }

    pub async fn report_projection_gap(
        &self,
        worker_token: &str,
        request: &ProjectionGapRequest,
    ) -> Result<ProjectionGapResponse, WorkerError> {
        let response = self
            .http
            .post(format!("{}/v1/cloud/worker/events/gaps", self.base_url))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(request)
            .send()
            .await?;
        parse_json_response(response).await
    }
}
