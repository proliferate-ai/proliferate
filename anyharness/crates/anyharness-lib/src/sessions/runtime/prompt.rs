use std::time::Instant;

use anyharness_contract::v1::PromptInputBlock;

use crate::acp::session_actor::{PromptAcceptError, PromptAcceptance, SessionCommand};
use crate::api::http::latency::{latency_trace_fields, LatencyRequestContext};
use crate::domains::plans::model::PlanRecord;
use crate::domains::plans::service::PlanService;
use crate::sessions::mcp_bindings::assembly::SESSION_RESTART_REQUIRED_DETAIL;
use crate::sessions::model::PromptAttachmentState;
use crate::sessions::prompt::{
    capabilities_from_live_config, prepare_prompt, PlanReferenceResolver, PromptPrepareContext,
    PromptProvenance,
};

use super::{
    SendPromptError, SendPromptOutcome, SessionLifecycleError, SessionRuntime, StartSessionError,
};

impl PlanReferenceResolver for PlanService {
    fn resolve_plan_reference(&self, plan_id: &str) -> anyhow::Result<Option<PlanRecord>> {
        self.get(plan_id)
    }
}

impl SessionRuntime {
    pub async fn send_prompt(
        &self,
        session_id: &str,
        blocks: Vec<PromptInputBlock>,
        prompt_id: Option<String>,
        latency: Option<&LatencyRequestContext>,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SendPromptError::Internal(anyhow::anyhow!(error.to_string())))?;
        if blocks.is_empty() {
            return Err(SendPromptError::EmptyPrompt);
        }
        let started = Instant::now();
        let latency_fields = latency_trace_fields(latency);
        let prompt_id = prompt_id.or_else(|| latency_fields.prompt_id.map(|s| s.to_string()));
        let prompt_id_for_trace = prompt_id.clone();
        tracing::info!(
            session_id = %session_id,
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = prompt_id_for_trace.as_deref(),
            "[workspace-latency] session.runtime.prompt.request_received"
        );

        let record = self
            .get_session_or_not_found(session_id)
            .map_err(map_lifecycle_error_to_prompt)?;

        let ensure_started = Instant::now();
        let handle = self
            .ensure_live_session_handle(&record, None, latency)
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
                plan_resolver: self.plan_service.as_ref(),
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
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = prompt_id_for_trace.as_deref(),
            "[workspace-latency] session.runtime.prompt.live_handle_ready"
        );

        // Invariant 1/2: the actor is the sole writer of `busy` and the queue.
        // The runtime no longer precaptures `busy`; it just forwards the command
        // and awaits the actor's decision (Started vs Queued).
        let (tx, rx) = tokio::sync::oneshot::channel();
        if handle
            .command_tx
            .send(SessionCommand::Prompt {
                payload: prepared.payload.clone(),
                prompt_id,
                latency: latency.cloned(),
                from_queue_seq: None,
                respond_to: tx,
            })
            .await
            .is_err()
        {
            return Err(SendPromptError::Internal(anyhow::anyhow!(
                "session actor channel closed"
            )));
        }
        tracing::info!(
            session_id = %session_id,
            total_elapsed_ms = started.elapsed().as_millis(),
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
            prompt_id = prompt_id_for_trace.as_deref(),
            "[workspace-latency] session.runtime.prompt.command_sent"
        );

        let acceptance = rx
            .await
            .map_err(|_| {
                SendPromptError::Internal(anyhow::anyhow!("session actor dropped response"))
            })?
            .map_err(|error| match error {
                PromptAcceptError::ActorDead => {
                    SendPromptError::Internal(anyhow::anyhow!("session actor is not responding"))
                }
                PromptAcceptError::EnqueueFailed(detail) => {
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
            flow_id = latency_fields.flow_id,
            flow_kind = latency_fields.flow_kind,
            flow_source = latency_fields.flow_source,
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
            .ensure_live_session_handle(&record, None, None)
            .await
            .map_err(map_start_error_to_prompt)?;
        let payload =
            crate::sessions::prompt::PromptPayload::text(text).with_provenance(provenance);
        let (tx, rx) = tokio::sync::oneshot::channel();
        handle
            .command_tx
            .send(SessionCommand::Prompt {
                payload,
                prompt_id: None,
                latency: None,
                from_queue_seq: None,
                respond_to: tx,
            })
            .await
            .map_err(|_| {
                SendPromptError::Internal(anyhow::anyhow!("session actor channel closed"))
            })?;
        let acceptance = rx
            .await
            .map_err(|_| {
                SendPromptError::Internal(anyhow::anyhow!("session actor dropped response"))
            })?
            .map_err(|error| match error {
                PromptAcceptError::ActorDead => {
                    SendPromptError::Internal(anyhow::anyhow!("session actor is not responding"))
                }
                PromptAcceptError::EnqueueFailed(detail) => {
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
        StartSessionError::MissingDataKey | StartSessionError::RestartRequired(_) => {
            SendPromptError::Internal(anyhow::anyhow!(SESSION_RESTART_REQUIRED_DETAIL))
        }
        StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
            SendPromptError::Internal(error)
        }
    }
}
