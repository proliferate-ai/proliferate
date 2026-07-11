use std::time::Instant;

use anyharness_contract::v1::PromptInputBlock;

use crate::domains::sessions::mcp_bindings::assembly::SESSION_RESTART_REQUIRED_DETAIL;
use crate::domains::sessions::model::PromptAttachmentState;
use crate::domains::sessions::prompt::capabilities::capabilities_from_live_config;
use crate::domains::sessions::prompt::prepare::prepare_prompt;
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::prompt::PromptPrepareContext;
use crate::live::sessions::{LiveSessionCommandError, PromptAcceptError, PromptAcceptance};

use super::{
    SendPromptError, SendPromptOutcome, SessionLifecycleError, SessionRuntime, StartSessionError,
};

impl SessionRuntime {
    #[tracing::instrument(skip_all, fields(session_id = %session_id))]
    pub async fn send_prompt(
        &self,
        session_id: &str,
        blocks: Vec<PromptInputBlock>,
        prompt_id: Option<String>,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(SendPromptError::Access)?;
        // L17 lockout (C13 / E8): a session held by a live workflow run rejects
        // every mutating verb; take-over is the only door.
        if let Some(run_id) = self.workflow_held_run(session_id) {
            return Err(SendPromptError::WorkflowHeld { run_id });
        }
        if blocks.is_empty() {
            return Err(SendPromptError::EmptyPrompt);
        }
        let started = Instant::now();
        let prompt_id_for_trace = prompt_id.clone();
        tracing::info!(
            session_id = %session_id,
            prompt_id = prompt_id_for_trace.as_deref(),
            "[workspace-latency] session.runtime.prompt.request_received"
        );

        let record = self
            .get_session_or_not_found(session_id)
            .map_err(map_lifecycle_error_to_prompt)?;

        let ensure_started = Instant::now();
        let handle = self
            .ensure_live_session_handle(&record, None)
            .await
            .map_err(map_start_error_to_prompt)?;
        let live_config = self
            .session_service
            .get_live_config_snapshot(session_id)
            .map_err(SendPromptError::Internal)?;
        let prepared = prepare_prompt(
            PromptPrepareContext {
                store: self.session_service.store(),
                attachment_storage: self.session_service.attachment_storage(),
                session_id,
                workspace_id: &record.workspace_id,
                capabilities: capabilities_from_live_config(live_config.as_ref()),
                attachment_state: PromptAttachmentState::Pending,
                plan_resolver: self.plan_reference_resolver.as_ref(),
            },
            blocks,
        )
        .map_err(SendPromptError::InvalidPrompt)?;
        prepared
            .persist_attachments(
                self.session_service.store(),
                self.session_service.attachment_storage(),
            )
            .map_err(SendPromptError::Internal)?;
        tracing::info!(
            session_id = %session_id,
            elapsed_ms = ensure_started.elapsed().as_millis(),
            total_elapsed_ms = started.elapsed().as_millis(),
            prompt_id = prompt_id_for_trace.as_deref(),
            "[workspace-latency] session.runtime.prompt.live_handle_ready"
        );

        // Invariant 1/2: the actor is the sole writer of `busy` and the queue.
        // The runtime no longer precaptures `busy`; it just forwards the command
        // and awaits the actor's decision (Started vs Queued).
        let acceptance = handle
            .send_prompt(prepared.payload.clone(), prompt_id)
            .await
            .map_err(|error| match error {
                LiveSessionCommandError::ActorUnavailable => {
                    SendPromptError::Internal(anyhow::anyhow!("session actor channel closed"))
                }
                LiveSessionCommandError::ResponseDropped => {
                    SendPromptError::Internal(anyhow::anyhow!("session actor dropped response"))
                }
                LiveSessionCommandError::Rejected(PromptAcceptError::EnqueueFailed(detail)) => {
                    let _ = prepared.cleanup_attachments(
                        self.session_service.store(),
                        self.session_service.attachment_storage(),
                        session_id,
                    );
                    SendPromptError::Internal(anyhow::anyhow!("failed to enqueue prompt: {detail}"))
                }
            })?;
        tracing::info!(
            session_id = %session_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            prompt_id = prompt_id_for_trace.as_deref(),
            "[workspace-latency] session.runtime.prompt.command_sent"
        );

        tracing::info!(
            session_id = %session_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            prompt_id = prompt_id_for_trace.as_deref(),
            "[workspace-latency] session.runtime.prompt.actor_accepted"
        );

        let session = self
            .session_service
            .get_session(session_id)
            .map_err(SendPromptError::Internal)?
            .unwrap_or(record);

        Ok(match acceptance {
            PromptAcceptance::Started { turn_id } => {
                SendPromptOutcome::Running { session, turn_id }
            }
            PromptAcceptance::Queued { seq } => SendPromptOutcome::Queued { session, seq },
        })
    }

    pub(crate) async fn send_text_prompt_with_provenance(
        &self,
        session_id: &str,
        text: String,
        provenance: PromptProvenance,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SendPromptError::Internal(anyhow::anyhow!(error.to_string())))?;
        if text.trim().is_empty() {
            return Err(SendPromptError::EmptyPrompt);
        }
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(map_lifecycle_error_to_prompt)?;
        let handle = self
            .ensure_live_session_handle(&record, None)
            .await
            .map_err(map_start_error_to_prompt)?;
        let payload =
            crate::domains::sessions::prompt::PromptPayload::text(text).with_provenance(provenance);
        let acceptance = handle
            .send_prompt(payload, None)
            .await
            .map_err(|error| match error {
                LiveSessionCommandError::ActorUnavailable => {
                    SendPromptError::Internal(anyhow::anyhow!("session actor channel closed"))
                }
                LiveSessionCommandError::ResponseDropped => {
                    SendPromptError::Internal(anyhow::anyhow!("session actor dropped response"))
                }
                LiveSessionCommandError::Rejected(PromptAcceptError::EnqueueFailed(detail)) => {
                    SendPromptError::Internal(anyhow::anyhow!("failed to enqueue prompt: {detail}"))
                }
            })?;
        let session = self
            .session_service
            .get_session(session_id)
            .map_err(SendPromptError::Internal)?
            .unwrap_or(record);
        Ok(match acceptance {
            PromptAcceptance::Started { turn_id } => {
                SendPromptOutcome::Running { session, turn_id }
            }
            PromptAcceptance::Queued { seq } => SendPromptOutcome::Queued { session, seq },
        })
    }
}

fn map_lifecycle_error_to_prompt(error: SessionLifecycleError) -> SendPromptError {
    match error {
        SessionLifecycleError::SessionNotFound(session_id) => {
            SendPromptError::SessionNotFound(session_id)
        }
        SessionLifecycleError::Access(error) => SendPromptError::Access(error),
        SessionLifecycleError::WorkflowHeld { run_id } => {
            SendPromptError::WorkflowHeld { run_id }
        }
        SessionLifecycleError::Internal(error) => SendPromptError::Internal(error),
    }
}

fn map_start_error_to_prompt(error: StartSessionError) -> SendPromptError {
    match error {
        StartSessionError::WorkspaceNotFound => {
            SendPromptError::Internal(anyhow::anyhow!("workspace not found for session"))
        }
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            SendPromptError::Internal(anyhow::anyhow!("agent descriptor not found: {agent_kind}"))
        }
        StartSessionError::Closed => SendPromptError::SessionClosed,
        StartSessionError::MissingDataKey | StartSessionError::RestartRequired(_) => {
            SendPromptError::Internal(anyhow::anyhow!(SESSION_RESTART_REQUIRED_DETAIL))
        }
        // Lazy-start on prompt: surface the typed agent-auth code so clients
        // can distinguish the fail-closed launch refusal from generic errors.
        StartSessionError::RouteAuth(error) => SendPromptError::InvalidPrompt(
            crate::domains::sessions::prompt::PromptValidationError::new(
                error.code(),
                error.to_string(),
            ),
        ),
        StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
            SendPromptError::Internal(error)
        }
    }
}
