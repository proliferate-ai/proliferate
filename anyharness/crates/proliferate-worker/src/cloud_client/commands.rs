use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::commands::result::{DispatchResult, DispatchStatus};
use crate::error::Result;

use super::{decode_empty, CloudClient};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudCommand {
    pub command_id: String,
    pub idempotency_key: Option<String>,
    pub lease_id: Option<String>,
    pub kind: CloudCommandKind,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    #[serde(default)]
    pub payload: Value,
    pub observed_event_seq: Option<i64>,
    #[serde(default)]
    pub preconditions: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudCommandKind {
    StartSession,
    SendPrompt,
    ResolveInteraction,
    UpdateSessionConfig,
    CancelTurn,
    CancelSession,
    StopWorkspace,
    HibernateWorkspace,
    ResumeWorkspace,
    PruneWorkspace,
    SnapshotWorkspace,
    ExtendWorkspaceTtl,
    SetWorkspacePin,
    SyncExistingWorkspace,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseCommandsRequest {
    pub target_id: String,
    pub worker_id: String,
    pub long_poll_timeout_ms: u64,
    pub max_commands: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseCommandsResponse {
    #[serde(default)]
    pub commands: Vec<CloudCommand>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryReport {
    pub target_id: String,
    pub worker_id: String,
    pub lease_id: Option<String>,
    pub status: DeliveryStatus,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryStatus {
    Delivered,
    FailedDelivery,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResultReport {
    pub target_id: String,
    pub worker_id: String,
    pub lease_id: Option<String>,
    pub status: DispatchStatus,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl CommandResultReport {
    pub fn from_dispatch(
        target_id: String,
        worker_id: String,
        lease_id: Option<String>,
        result: DispatchResult,
    ) -> Self {
        Self {
            target_id,
            worker_id,
            lease_id,
            status: result.status,
            error_code: result.error_code,
            error_message: result.error_message,
        }
    }
}

impl CloudClient {
    pub async fn lease_commands(
        &self,
        request: &LeaseCommandsRequest,
    ) -> Result<LeaseCommandsResponse> {
        self.post_json("v1/cloud/worker/commands/lease", request)
            .await
    }

    pub async fn report_delivery(&self, command_id: &str, report: &DeliveryReport) -> Result<()> {
        let path = format!("v1/cloud/worker/commands/{command_id}/delivery");
        let request = self.http.post(self.endpoint(&path)?).json(report);
        let response = if let Some(auth) = &self.auth {
            auth.apply(request)
        } else {
            request
        }
        .send()
        .await?;
        decode_empty(response).await
    }

    pub async fn report_command_result(
        &self,
        command_id: &str,
        report: &CommandResultReport,
    ) -> Result<()> {
        let path = format!("v1/cloud/worker/commands/{command_id}/result");
        let request = self.http.post(self.endpoint(&path)?).json(report);
        let response = if let Some(auth) = &self.auth {
            auth.apply(request)
        } else {
            request
        }
        .send()
        .await?;
        decode_empty(response).await
    }
}
