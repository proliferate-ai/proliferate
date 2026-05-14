use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::WorkerError;

use super::{auth, parse_json_response, CloudClient};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerBackfillRepoRef {
    pub provider: Option<String>,
    pub owner: Option<String>,
    pub name: Option<String>,
    pub branch: Option<String>,
    pub base_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerBackfillWorkspace {
    pub workspace_id: String,
    pub display_name: Option<String>,
    pub path: Option<String>,
    pub repo: Option<WorkerBackfillRepoRef>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerBackfillPendingInteraction {
    pub request_id: String,
    pub kind: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerBackfillSession {
    pub session_id: String,
    pub workspace_id: Option<String>,
    pub native_session_id: Option<String>,
    pub source_agent_kind: Option<String>,
    pub title: Option<String>,
    pub status: Option<String>,
    pub phase: Option<String>,
    pub live_config: Option<Value>,
    pub last_event_seq: i64,
    pub last_event_at: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub pending_interactions: Vec<WorkerBackfillPendingInteraction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerBackfillRequest {
    pub workspaces: Vec<WorkerBackfillWorkspace>,
    pub sessions: Vec<WorkerBackfillSession>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerBackfillWorkspaceMapping {
    pub workspace_id: String,
    pub cloud_workspace_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerBackfillSessionMapping {
    pub session_id: String,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerBackfillResponse {
    pub mapped_workspaces: Vec<WorkerBackfillWorkspaceMapping>,
    pub mapped_sessions: Vec<WorkerBackfillSessionMapping>,
}

impl CloudClient {
    pub async fn upload_backfill(
        &self,
        worker_token: &str,
        request: &WorkerBackfillRequest,
    ) -> Result<WorkerBackfillResponse, WorkerError> {
        let response = self
            .http
            .post(format!("{}/v1/cloud/worker/backfill", self.base_url))
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
