use std::sync::Arc;
use std::time::{Duration, Instant};

use anyharness_contract::v1::PromptInputBlock;

use crate::domains::sessions::mcp_bindings::assembly::SESSION_RESTART_REQUIRED_DETAIL;
use crate::domains::sessions::model::PromptAttachmentState;
use crate::domains::sessions::prompt::capabilities::capabilities_from_live_config;
use crate::domains::sessions::prompt::prepare::prepare_prompt;
use crate::domains::sessions::prompt::provenance::{AgentSessionPromptSource, PromptProvenance};
use crate::domains::sessions::prompt::PromptPrepareContext;
use crate::live::sessions::{LiveSessionCommandError, PromptAcceptError, PromptAcceptance};

use super::{
    SendPromptError, SendPromptOutcome, SessionLifecycleError, SessionRuntime, StartSessionError,
};

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
    pub async fn send_prompt(
        &self,
        session_id: &str,
        blocks: Vec<PromptInputBlock>,
        prompt_id: Option<String>,
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

        // Turn-start checkpoint (Lane H), just before dispatch. A capture failure
        // under the abort policy returns here and the turn never starts.
        let checkpoint_id = self
            .capture_turn_start_checkpoint(
                &record.workspace_id,
                session_id,
                &handle,
                prompt_id_for_trace.as_deref(),
            )
            .await?;

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

        self.finalize_turn_start_checkpoint(checkpoint_id, &acceptance)
            .await;

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
        self.send_text_prompt_with_id_inner(session_id, text, prompt_id, None)
            .await
    }

    /// Creation-only variant carrying trusted agent-session provenance without
    /// activating the general cross-agent message surface.
    pub(crate) async fn send_text_prompt_with_id_and_provenance(
        &self,
        session_id: &str,
        text: String,
        prompt_id: String,
        provenance: PromptProvenance,
    ) -> Result<SendPromptOutcome, TextPromptDispatchError> {
        self.send_text_prompt_with_id_inner(session_id, text, prompt_id, Some(provenance))
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
        self.send_payload_prompt_with_id(session_id, payload, prompt_id)
            .await
    }

    async fn send_text_prompt_with_id_inner(
        &self,
        session_id: &str,
        text: String,
        prompt_id: String,
        provenance: Option<PromptProvenance>,
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
        self.send_payload_prompt_with_id(session_id, payload, prompt_id)
            .await
    }

    async fn send_payload_prompt_with_id(
        &self,
        session_id: &str,
        payload: crate::domains::sessions::prompt::PromptPayload,
        prompt_id: String,
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
        // Turn-start checkpoint (Lane H). A capture failure under the abort
        // policy maps into a failed dispatch here, exactly like a start failure.
        let checkpoint_id = self
            .capture_turn_start_checkpoint(
                &record.workspace_id,
                session_id,
                &handle,
                Some(prompt_id.as_str()),
            )
            .await
            .map_err(TextPromptDispatchError::Dispatch)?;
        let acceptance = handle
            .send_prompt(payload, Some(prompt_id))
            .await
            .map_err(classify_text_prompt_command_error)?;
        self.finalize_turn_start_checkpoint(checkpoint_id, &acceptance)
            .await;
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
        // Turn-start checkpoint (Lane H) before dispatch.
        let checkpoint_id = self
            .capture_turn_start_checkpoint(&record.workspace_id, session_id, &handle, None)
            .await?;
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
        self.finalize_turn_start_checkpoint(checkpoint_id, &acceptance)
            .await;
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

    /// Turn-start checkpoint capture (Lane H), called at every prompt dispatch
    /// seam just before `handle.send_prompt`. Returns the captured checkpoint id
    /// (to be finalized after dispatch), or `None` when nothing was captured.
    ///
    /// Flag-off is zero work: no store reads, no git. A busy handle means the
    /// prompt will queue mid-turn, and a snapshot labelled as THIS boundary would
    /// be dishonest, so capture is skipped. On a capture failure the selected
    /// [`TURN_START_CAPTURE_FAILURE_POLICY`] decides: `Abort` returns a typed
    /// error (the turn never starts), `Degrade` warns and proceeds without a
    /// checkpoint.
    ///
    /// Known gap: turns started by the actor draining its own queue get no
    /// checkpoint in this PR — the hook lives at the runtime dispatch seam, not
    /// inside the actor's queue-replay loop.
    async fn capture_turn_start_checkpoint(
        &self,
        workspace_id: &str,
        session_id: &str,
        handle: &crate::live::sessions::LiveSessionHandle,
        prompt_id: Option<&str>,
    ) -> Result<Option<String>, SendPromptError> {
        use crate::domains::workspaces::checkpoints::flags::{
            checkpoint_capture_enabled, CaptureFailurePolicy, TURN_START_CAPTURE_FAILURE_POLICY,
        };
        use crate::domains::workspaces::checkpoints::CheckpointOrigin;

        if !checkpoint_capture_enabled() {
            return Ok(None);
        }
        if handle.is_busy() {
            tracing::debug!(
                session_id = %session_id,
                "checkpoint capture skipped: the session is busy and this prompt will queue"
            );
            return Ok(None);
        }
        match self
            .checkpoint_service
            .capture(
                workspace_id,
                CheckpointOrigin::TurnStart,
                Some(session_id.to_string()),
                prompt_id.map(str::to_string),
            )
            .await
        {
            Ok(record) => Ok(Some(record.id)),
            Err(error) => match TURN_START_CAPTURE_FAILURE_POLICY {
                CaptureFailurePolicy::Abort => Err(SendPromptError::CheckpointCaptureFailed {
                    reason: error.to_string(),
                }),
                CaptureFailurePolicy::Degrade => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %error,
                        "checkpoint capture failed; proceeding without a checkpoint (degrade policy)"
                    );
                    Ok(None)
                }
            },
        }
    }

    /// Post-dispatch bookkeeping for a turn-start checkpoint. `Started` backfills
    /// the real `turn_id`; `Queued` means the race was lost, so the checkpoint is
    /// expired and its refs deleted. Non-fatal: a bookkeeping error is logged, it
    /// never fails a prompt whose command was already accepted.
    async fn finalize_turn_start_checkpoint(
        &self,
        checkpoint_id: Option<String>,
        acceptance: &PromptAcceptance,
    ) {
        let Some(checkpoint_id) = checkpoint_id else {
            return;
        };
        match acceptance {
            PromptAcceptance::Started { turn_id } => {
                if let Err(error) = self.checkpoint_service.set_turn_id(&checkpoint_id, turn_id) {
                    tracing::warn!(
                        checkpoint_id = %checkpoint_id,
                        error = %error,
                        "could not backfill a checkpoint's turn_id after dispatch"
                    );
                }
            }
            PromptAcceptance::Queued { .. } => {
                if let Err(error) = self.checkpoint_service.expire_and_delete(&checkpoint_id).await {
                    tracing::warn!(
                        checkpoint_id = %checkpoint_id,
                        error = %error,
                        "could not expire a checkpoint whose turn queued"
                    );
                }
            }
        }
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

/// Pure classification of a live-session command failure for the text-prompt
/// seam: `ResponseDropped` is the one ambiguous case — it proves the command
/// was enqueued to the actor's mailbox, not that the actor processed it, and
/// the reply was lost either way; `ActorUnavailable` (command never enqueued)
/// and an explicit rejection are safe to report as failed dispatch.
fn classify_text_prompt_command_error(
    error: LiveSessionCommandError<PromptAcceptError>,
) -> TextPromptDispatchError {
    match error {
        LiveSessionCommandError::ResponseDropped => TextPromptDispatchError::AcknowledgementLost,
        LiveSessionCommandError::ActorUnavailable => TextPromptDispatchError::Dispatch(
            SendPromptError::Internal(anyhow::anyhow!("session actor channel closed")),
        ),
        LiveSessionCommandError::Rejected(PromptAcceptError::EnqueueFailed(detail)) => {
            TextPromptDispatchError::Dispatch(SendPromptError::Internal(anyhow::anyhow!(
                "failed to enqueue prompt: {detail}"
            )))
        }
        LiveSessionCommandError::Rejected(PromptAcceptError::ProductContextUnavailable {
            incident_id,
            error,
        }) => TextPromptDispatchError::Dispatch(SendPromptError::ProductContextUnavailable {
            incident_id,
            error,
        }),
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

fn durable_prompt_start_failure_code(error: &StartSessionError) -> &'static str {
    match error {
        StartSessionError::WorkspaceNotFound => "workspace_not_found",
        StartSessionError::WorkspaceDirectoryMissing { .. } => "workspace_directory_missing",
        StartSessionError::AgentDescriptorNotFound(_) => "agent_descriptor_not_found",
        StartSessionError::Closed => "session_closed",
        StartSessionError::MissingDataKey => "missing_data_key",
        StartSessionError::RestartRequired(_) => "restart_required",
        StartSessionError::WorkspaceMcpAttachmentFailed(_) => "workspace_mcp_attachment_failed",
        StartSessionError::RouteAuth(_) => "route_auth",
        StartSessionError::AgentNotReady { .. } => "agent_not_ready",
        StartSessionError::Internal(_) => "internal",
        StartSessionError::AcpStart(_) => "acp_start",
    }
}

fn map_start_error_to_prompt(error: StartSessionError) -> SendPromptError {
    match error {
        StartSessionError::WorkspaceNotFound => {
            SendPromptError::Internal(anyhow::anyhow!("workspace not found for session"))
        }
        StartSessionError::WorkspaceDirectoryMissing { path } => {
            SendPromptError::WorkspaceDirectoryMissing { path }
        }
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            SendPromptError::Internal(anyhow::anyhow!("agent descriptor not found: {agent_kind}"))
        }
        StartSessionError::Closed => SendPromptError::SessionClosed,
        StartSessionError::MissingDataKey | StartSessionError::RestartRequired(_) => {
            SendPromptError::Internal(anyhow::anyhow!(SESSION_RESTART_REQUIRED_DETAIL))
        }
        StartSessionError::WorkspaceMcpAttachmentFailed(error) => {
            SendPromptError::WorkspaceMcpAttachmentFailed(error)
        }
        // Lazy-start on prompt: surface the typed agent-auth code so clients
        // can distinguish the fail-closed launch refusal from generic errors.
        StartSessionError::RouteAuth(error) => SendPromptError::InvalidPrompt(
            crate::domains::sessions::prompt::PromptValidationError::new(
                error.code(),
                error.to_string(),
            ),
        ),
        // A9 Scope C: lazy-start on prompt hits the same live-start readiness
        // gate as resume/fork/create now. SendPromptError has no dedicated
        // readiness variant, so this rides InvalidPrompt with a stable
        // AGENT_NOT_READY code, same shape as the RouteAuth arm above.
        StartSessionError::AgentNotReady {
            agent_kind,
            status,
            detail,
        } => {
            let message = match detail {
                Some(detail) => {
                    format!("agent '{agent_kind}' is not ready (status: {status:?}): {detail}")
                }
                None => format!("agent '{agent_kind}' is not ready (status: {status:?})"),
            };
            SendPromptError::InvalidPrompt(
                crate::domains::sessions::prompt::PromptValidationError::new(
                    "AGENT_NOT_READY",
                    message,
                ),
            )
        }
        StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
            SendPromptError::Internal(error)
        }
    }
}

#[cfg(test)]
mod dispatch_classification_tests {
    use super::*;
    use crate::domains::agents::model::ResolvedAgentStatus;

    #[test]
    fn send_message_start_failure_codes_do_not_expose_details() {
        let cases = [
            (
                StartSessionError::WorkspaceDirectoryMissing {
                    path: "/secret/workspace".into(),
                },
                "workspace_directory_missing",
            ),
            (
                StartSessionError::AgentNotReady {
                    agent_kind: "secret-agent".into(),
                    status: ResolvedAgentStatus::Error,
                    detail: Some("secret readiness detail".into()),
                },
                "agent_not_ready",
            ),
            (
                StartSessionError::Internal(anyhow::anyhow!("secret")),
                "internal",
            ),
            (
                StartSessionError::AcpStart(anyhow::anyhow!("secret")),
                "acp_start",
            ),
        ];

        for (error, expected) in cases {
            assert_eq!(durable_prompt_start_failure_code(&error), expected);
        }
    }

    #[test]
    fn response_dropped_is_a_lost_acknowledgement() {
        assert!(matches!(
            classify_text_prompt_command_error(LiveSessionCommandError::ResponseDropped),
            TextPromptDispatchError::AcknowledgementLost
        ));
    }

    #[test]
    fn actor_unavailable_and_rejection_are_failed_dispatch() {
        assert!(matches!(
            classify_text_prompt_command_error(LiveSessionCommandError::ActorUnavailable),
            TextPromptDispatchError::Dispatch(SendPromptError::Internal(_))
        ));
        assert!(matches!(
            classify_text_prompt_command_error(LiveSessionCommandError::Rejected(
                PromptAcceptError::EnqueueFailed("queue closed".to_string())
            )),
            TextPromptDispatchError::Dispatch(SendPromptError::Internal(_))
        ));
        assert!(matches!(
            classify_text_prompt_command_error(LiveSessionCommandError::Rejected(
                PromptAcceptError::ProductContextUnavailable {
                    incident_id: "incident-1".to_string(),
                    error: crate::live::sessions::product_context::AgentProductContextResolutionError::new(
                        anyhow::anyhow!("private")
                    ),
                }
            )),
            TextPromptDispatchError::Dispatch(
                SendPromptError::ProductContextUnavailable { incident_id, .. }
            ) if incident_id == "incident-1"
        ));
    }
}
