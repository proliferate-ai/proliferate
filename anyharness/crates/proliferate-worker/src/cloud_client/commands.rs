use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::WorkerError;

use super::{auth, parse_empty_response, parse_json_response, CloudClient};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseCommandRequest {
    pub supported_kinds: Vec<String>,
    pub lease_timeout_seconds: Option<u64>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloudCommandEnvelope {
    pub command_id: String,
    pub idempotency_key: String,
    pub target_id: String,
    pub workspace_id: Option<String>,
    pub cloud_workspace_id: Option<String>,
    pub sandbox_profile_id: Option<String>,
    pub session_id: Option<String>,
    pub kind: String,
    pub payload: Value,
    pub observed_event_seq: Option<i64>,
    pub preconditions: Option<Value>,
    pub lease_id: String,
    pub lease_expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseCommandResponse {
    pub command: Option<CloudCommandEnvelope>,
    pub server_time: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandDeliveryRequest {
    pub lease_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_workspace_id: Option<String>,
    pub status: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResultRequest {
    pub lease_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anyharness_workspace_id: Option<String>,
    pub status: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub result: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializationReportRequest {
    pub cloud_workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anyharness_workspace_id: Option<String>,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_last_error: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub blockers: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reclaimed_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<i64>,
}

pub const SUPPORTED_COMMAND_KINDS: &[&str] = &[
    "start_session",
    "configure_git_identity",
    "ensure_repo_checkout",
    "materialize_workspace",
    "prune_workspace_worktree",
    "materialize_environment",
    "refresh_agent_auth_config",
    "send_prompt",
    "decide_plan",
    "resolve_interaction",
    "update_session_config",
    "cancel_turn",
    "close_session",
    "backfill_exposed_workspace",
];

impl CloudClient {
    pub async fn lease_command(
        &self,
        worker_token: &str,
        request: &LeaseCommandRequest,
    ) -> Result<LeaseCommandResponse, WorkerError> {
        let response = self
            .http
            .post(format!("{}/v1/cloud/worker/commands/lease", self.base_url))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(request)
            .send()
            .await?;
        parse_json_response(response).await
    }

    pub async fn report_command_delivery(
        &self,
        worker_token: &str,
        command_id: &str,
        request: &CommandDeliveryRequest,
    ) -> Result<(), WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/worker/commands/{}/delivery",
                self.base_url, command_id
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

    pub async fn report_command_result(
        &self,
        worker_token: &str,
        command_id: &str,
        request: &CommandResultRequest,
    ) -> Result<(), WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/worker/commands/{}/result",
                self.base_url, command_id
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

    pub async fn report_materialization(
        &self,
        worker_token: &str,
        request: &MaterializationReportRequest,
    ) -> Result<(), WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/worker/materialization-reports",
                self.base_url
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
