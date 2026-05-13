use serde_json::json;

use crate::anyharness_client::sessions::required_session_id;
use crate::anyharness_client::AnyHarnessClient;
use crate::cloud_client::commands::{CloudCommand, CloudCommandKind};
use crate::commands::{mapping, preconditions};
use crate::error::Result;
use crate::lifecycle;

use super::result::DispatchResult;

#[derive(Clone)]
pub struct CommandDispatcher {
    anyharness: AnyHarnessClient,
}

impl CommandDispatcher {
    pub fn new(anyharness: AnyHarnessClient) -> Self {
        Self { anyharness }
    }

    pub async fn dispatch(&self, command: &CloudCommand) -> Result<DispatchResult> {
        if let Some(message) =
            preconditions::check_local_preconditions(&self.anyharness, command).await?
        {
            return Ok(DispatchResult::rejected("PRECONDITION_UNVERIFIED", message));
        }

        match command.kind {
            CloudCommandKind::StartSession => {
                let payload = mapping::start_session_payload(command);
                self.anyharness
                    .create_session(&payload)
                    .await
                    .map(DispatchResult::from_local)
            }
            CloudCommandKind::SendPrompt => {
                let session_id =
                    required_session_id(&command.command_id, command.session_id.as_deref())?;
                let payload = mapping::prompt_payload(command);
                self.anyharness
                    .send_prompt(&session_id, &payload)
                    .await
                    .map(DispatchResult::from_local)
            }
            CloudCommandKind::ResolveInteraction => {
                let session_id =
                    required_session_id(&command.command_id, command.session_id.as_deref())?;
                let Some(request_id) = mapping::interaction_request_id(command) else {
                    return Ok(DispatchResult::rejected(
                        "MISSING_INTERACTION_ID",
                        "resolve_interaction command payload requires interactionId/requestId",
                    ));
                };
                let payload = mapping::interaction_payload(command);
                self.anyharness
                    .resolve_interaction(&session_id, &request_id, &payload)
                    .await
                    .map(DispatchResult::from_local)
            }
            CloudCommandKind::UpdateSessionConfig => {
                let session_id =
                    required_session_id(&command.command_id, command.session_id.as_deref())?;
                let payload = mapping::config_payload(command);
                self.anyharness
                    .update_session_config(&session_id, &payload)
                    .await
                    .map(DispatchResult::from_local)
            }
            CloudCommandKind::CancelTurn | CloudCommandKind::CancelSession => {
                let session_id =
                    required_session_id(&command.command_id, command.session_id.as_deref())?;
                self.anyharness
                    .cancel_session(&session_id)
                    .await
                    .map(DispatchResult::from_local)
            }
            CloudCommandKind::StopWorkspace
            | CloudCommandKind::HibernateWorkspace
            | CloudCommandKind::ResumeWorkspace
            | CloudCommandKind::PruneWorkspace
            | CloudCommandKind::SnapshotWorkspace
            | CloudCommandKind::ExtendWorkspaceTtl
            | CloudCommandKind::SetWorkspacePin => self.dispatch_compute(command).await,
            CloudCommandKind::SyncExistingWorkspace => Ok(DispatchResult::accepted_but_queued(
                json!({ "status": "queued", "reason": "sync backfill is handled by the worker sync loop" }),
            )),
        }
    }

    async fn dispatch_compute(&self, command: &CloudCommand) -> Result<DispatchResult> {
        let safe_stop =
            lifecycle::safe_stop::assess_workspace(&self.anyharness, command.workspace_id.clone())
                .await;
        let response = json!({
            "status": "queued",
            "kind": command.kind,
            "safeStop": safe_stop,
            "message": "worker accepted compute command for supervisor/platform coordination; direct lifecycle mutation is not implemented in V1 skeleton"
        });
        Ok(DispatchResult::accepted_but_queued(response))
    }
}
