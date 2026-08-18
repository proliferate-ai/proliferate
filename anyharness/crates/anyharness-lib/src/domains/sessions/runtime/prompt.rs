use std::sync::Arc;
use std::time::{Duration, Instant};

use anyharness_contract::v1::PromptInputBlock;

use crate::domains::sessions::model::PromptAttachmentState;
use crate::domains::sessions::prompt::capabilities::capabilities_from_live_config;
use crate::domains::sessions::prompt::prepare::prepare_prompt;
use crate::domains::sessions::prompt::provenance::{AgentSessionPromptSource, PromptProvenance};
use crate::domains::sessions::prompt::PromptPrepareContext;
use crate::live::sessions::{LiveSessionCommandError, PromptAcceptError, PromptAcceptance};

use super::prompt_errors::{
    classify_text_prompt_command_error, durable_prompt_start_failure_code,
    map_lifecycle_error_to_prompt, map_start_error_to_prompt,
};
use super::prompt_title::PromptTitleAssignment;
use super::{SendPromptError, SendPromptOutcome, SessionRuntime};

impl SessionRuntime {
    /// Persist-first cross-agent delivery. The pending-row sequence is the
    /// acceptance linearization point. Actor startup and the bounded queue wake
    /// are detached after that commit (see below) and are best-effort because
    /// startup queue replay owns eventual processing.
    pub(crate) async fn enqueue_agent_message(
        self: Arc<Self>,
        session_id: &str,
        message: String,
        source: AgentSessionPromptSource,
    ) -> Result<i64, SendPromptError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SendPromptError::Internal(anyhow::anyhow!(error.to_string())))?;
        if message.trim().is_empty() {
            return Err(SendPromptError::EmptyPrompt);
        }
        let record = self
            .get_session_or_not_found(session_id)
            .map_err(map_lifecycle_error_to_prompt)?;
        if super::launch_policy::session_is_closed(&record) {
            return Err(SendPromptError::SessionClosed);
        }
        let payload = crate::domains::sessions::prompt::PromptPayload::text(message)
            .with_provenance(source.into_provenance());
        let pending = self
            .session_service
            .store()
            .insert_pending_prompt_payload(session_id, &payload, None)
            .map_err(SendPromptError::Internal)?;

        // Detach activation after the durable commit. The pending row above is
        // the acceptance linearization point and startup queue replay owns
        // eventual processing, so activation is strictly best-effort. Awaiting
        // it inline would block the caller (an MCP `send_message` tool call)
        // for up to the shared startup-readiness timeout (60s in prod) while a
        // cold target boots, even though the receipt is already durable.
        //
        // Lease invariant: the spawned task runs WITHOUT the caller's
        // target-workspace shared `SessionPrompt` lease (that lease is dropped
        // when `send_message` returns, right after this fn). This is deliberate
        // and mirrors the startup-replay path, which activates consumers
        // without holding any caller lease: the pending row is already durable,
        // so no lease is required to guarantee eventual delivery, and
        // re-acquiring one here would reintroduce the block this detach removes.
        let queue_seq = pending.seq;
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            self.activate_durable_prompt_consumer(&session_id, payload, queue_seq)
                .await;
        });

        Ok(queue_seq)
    }
    pub(crate) async fn activate_durable_prompt_consumer(
        &self,
        session_id: &str,
        payload: crate::domains::sessions::prompt::PromptPayload,
        queue_seq: i64,
    ) {
        const WAKE_ACK_TIMEOUT: Duration = Duration::from_secs(1);

        let record = match self.get_session_or_not_found(session_id) {
            Ok(record) => record,
            Err(error) => {
                tracing::warn!(
                    session_id = %session_id,
                    queue_seq,
                    error = ?error,
                    "durable prompt consumer activation skipped; pending prompt will replay"
                );
                return;
            }
        };
        let handle = match self.ensure_live_session_handle(&record, None).await {
            Ok(handle) => handle,
            Err(error) => {
                tracing::warn!(
                    session_id = %session_id,
                    queue_seq,
                    failure_code = durable_prompt_start_failure_code(&error),
                    "durable prompt consumer startup failed; pending prompt will replay"
                );
                return;
            }
        };

        match tokio::time::timeout(
            WAKE_ACK_TIMEOUT,
            handle.send_queued_prompt(payload, queue_seq),
        )
        .await
        {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => tracing::warn!(
                session_id = %session_id,
                queue_seq,
                error = ?error,
                "durable prompt wake acknowledgement was lost; pending prompt will replay"
            ),
            Err(_) => tracing::warn!(
                session_id = %session_id,
                queue_seq,
                timeout_ms = WAKE_ACK_TIMEOUT.as_millis(),
                "durable prompt wake acknowledgement timed out; pending prompt will replay"
            ),
        }
    }

    #[tracing::instrument(skip_all, fields(session_id = %session_id))]
    pub async fn send_authored_prompt(
        &self,
        session_id: &str,
        blocks: Vec<PromptInputBlock>,
        prompt_id: Option<String>,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        let title_assignment = PromptTitleAssignment::from_authored_texts(
            blocks.iter().filter_map(|block| match block {
                PromptInputBlock::Text { text } => Some(text.as_str()),
                _ => None,
            }),
        );
        self.send_prompt_with_title_assignment(session_id, blocks, prompt_id, title_assignment)
            .await
    }

    #[tracing::instrument(skip_all, fields(session_id = %session_id))]
    pub async fn send_prompt(
        &self,
        session_id: &str,
        blocks: Vec<PromptInputBlock>,
        prompt_id: Option<String>,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        self.send_prompt_with_title_assignment(
            session_id,
            blocks,
            prompt_id,
            PromptTitleAssignment::Disabled,
        )
        .await
    }

    async fn send_prompt_with_title_assignment(
        &self,
        session_id: &str,
        blocks: Vec<PromptInputBlock>,
        prompt_id: Option<String>,
        title_assignment: PromptTitleAssignment,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SendPromptError::Internal(anyhow::anyhow!(error.to_string())))?;
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
        let assigned = title_assignment.apply_before_dispatch(self, session_id);
        let acceptance = handle
            .send_prompt(prepared.payload.clone(), prompt_id)
            .await
            .inspect_err(|error| assigned.revert_if_undelivered(self, session_id, error))
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
                LiveSessionCommandError::Rejected(
                    PromptAcceptError::ProductContextUnavailable { incident_id, error },
                ) => {
                    let _ = prepared.cleanup_attachments(
                        self.session_service.store(),
                        self.session_service.attachment_storage(),
                        session_id,
                    );
                    SendPromptError::ProductContextUnavailable { incident_id, error }
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
        let session = assigned.merge_into(session);

        Ok(match acceptance {
            PromptAcceptance::Started { turn_id } => {
                SendPromptOutcome::Running { session, turn_id }
            }
            PromptAcceptance::Queued { seq } => SendPromptOutcome::Queued { session, seq },
        })
    }

    /// Domain-owned text-only prompt seam with a caller-supplied deterministic
    /// `prompt_id`. Reuses the normal access check, live handle, actor command,
    /// and `Started`/`Queued` result. No provenance, no wire `PromptInputBlock`.
    ///
    /// The typed error separates a genuinely failed dispatch from a LOST
    /// acknowledgement: when the prompt command was accepted into the actor's
    /// mailbox but the reply channel dropped, the actor may or may not have
    /// processed it and the turn may in fact be running, so the caller must
    /// not treat it as a failure.
    pub(crate) async fn send_text_prompt_with_id(
        &self,
        session_id: &str,
        text: String,
        prompt_id: String,
    ) -> Result<SendPromptOutcome, TextPromptDispatchError> {
        self.send_text_prompt_with_id_inner(
            session_id,
            text,
            prompt_id,
            None,
            PromptTitleAssignment::Disabled,
        )
        .await
    }

    /// Creation-only variant carrying trusted agent-session provenance without
    /// activating the general cross-agent message surface.
    pub(crate) async fn send_initial_task_prompt_with_id(
        &self,
        session_id: &str,
        text: String,
        prompt_id: String,
        provenance: PromptProvenance,
    ) -> Result<SendPromptOutcome, TextPromptDispatchError> {
        let title_assignment =
            PromptTitleAssignment::from_authored_texts(std::iter::once(text.as_str()));
        self.send_text_prompt_with_id_inner(
            session_id,
            text,
            prompt_id,
            Some(provenance),
            title_assignment,
        )
        .await
    }

    /// Workflow-owned multi-block twin of [`Self::send_text_prompt_with_id`]:
    /// the leading blocks are a node envelope's already-wrapped
    /// system-instruction blocks, delivered in-band ahead of the first
    /// message, which is always the LAST block (Ruling D). Same access check,
    /// live handle, actor command, and acknowledgement-ambiguity contract.
    pub(crate) async fn send_text_blocks_prompt_with_id(
        &self,
        session_id: &str,
        texts: Vec<String>,
        prompt_id: String,
    ) -> Result<SendPromptOutcome, TextPromptDispatchError> {
        let payload = crate::domains::sessions::prompt::PromptPayload::text_blocks(texts);
        if payload.blocks.is_empty() {
            return Err(TextPromptDispatchError::Dispatch(
                SendPromptError::EmptyPrompt,
            ));
        }
        self.send_payload_prompt_with_id(
            session_id,
            payload,
            prompt_id,
            PromptTitleAssignment::Disabled,
        )
        .await
    }

    async fn send_text_prompt_with_id_inner(
        &self,
        session_id: &str,
        text: String,
        prompt_id: String,
        provenance: Option<PromptProvenance>,
        title_assignment: PromptTitleAssignment,
    ) -> Result<SendPromptOutcome, TextPromptDispatchError> {
        if text.trim().is_empty() {
            return Err(TextPromptDispatchError::Dispatch(
                SendPromptError::EmptyPrompt,
            ));
        }
        let mut payload = crate::domains::sessions::prompt::PromptPayload::text(text);
        if let Some(provenance) = provenance {
            payload = payload.with_provenance(provenance);
        }
        self.send_payload_prompt_with_id(session_id, payload, prompt_id, title_assignment)
            .await
    }

    async fn send_payload_prompt_with_id(
        &self,
        session_id: &str,
        payload: crate::domains::sessions::prompt::PromptPayload,
        prompt_id: String,
        title_assignment: PromptTitleAssignment,
    ) -> Result<SendPromptOutcome, TextPromptDispatchError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| {
                TextPromptDispatchError::Dispatch(SendPromptError::Internal(anyhow::anyhow!(
                    error.to_string()
                )))
            })?;
        let record = self.get_session_or_not_found(session_id).map_err(|error| {
            TextPromptDispatchError::Dispatch(map_lifecycle_error_to_prompt(error))
        })?;
        let handle = self
            .ensure_live_session_handle(&record, None)
            .await
            .map_err(|error| TextPromptDispatchError::Dispatch(map_start_error_to_prompt(error)))?;
        let assigned = title_assignment.apply_before_dispatch(self, session_id);
        let acceptance = handle
            .send_prompt(payload, Some(prompt_id))
            .await
            .inspect_err(|error| assigned.revert_if_undelivered(self, session_id, error))
            .map_err(classify_text_prompt_command_error)?;
        // The prompt is accepted at this point; the re-read only refreshes the
        // returned snapshot. A failure here must not become a dispatch error
        // (the caller would terminalize a prompt that is actually running), so
        // fall back to the record loaded before dispatch.
        let session = self
            .session_service
            .get_session(session_id)
            .ok()
            .flatten()
            .unwrap_or(record);
        let session = assigned.merge_into(session);
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
                LiveSessionCommandError::Rejected(
                    PromptAcceptError::ProductContextUnavailable { incident_id, error },
                ) => SendPromptError::ProductContextUnavailable { incident_id, error },
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

/// Typed failure for the deterministic-prompt-id seam. `AcknowledgementLost`
/// means the command was accepted into the actor's mailbox but the reply
/// channel dropped before an acknowledgement arrived: the actor may or may
/// not have processed the prompt, so callers must not record a terminal
/// failure (mirror of the spec rule "never claim completion" — never claim
/// failure on an ambiguous acknowledgement either).
#[derive(Debug)]
pub(crate) enum TextPromptDispatchError {
    /// The prompt command was enqueued to the actor but its acknowledgement
    /// was lost; whether the actor processed it is unknown.
    AcknowledgementLost,
    /// The dispatch verifiably failed before or at command delivery.
    Dispatch(SendPromptError),
}
