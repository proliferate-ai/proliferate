use std::time::Instant;

use anyharness_contract::v1::PromptInputBlock;

use crate::domains::sessions::mcp_bindings::assembly::SESSION_RESTART_REQUIRED_DETAIL;
use crate::domains::sessions::model::PromptAttachmentState;
use crate::domains::sessions::prompt::capabilities::capabilities_from_live_config;
use crate::domains::sessions::prompt::prepare::prepare_prompt;
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::prompt::PromptPrepareContext;
use crate::live::sessions::{LiveSessionCommandError, PromptAcceptError, PromptAcceptance};

use super::prompt_dispatch::{classify_text_prompt_command_error, TextPromptDispatchError};
use super::prompt_lease::PromptWorkspaceLeaseMode;
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
        self.send_prompt_with_lease_mode(
            session_id,
            blocks,
            prompt_id,
            PromptWorkspaceLeaseMode::Acquire,
        )
        .await
    }

    /// Prompt twin for a caller that already owns a shared workspace operation
    /// lease across this full dispatch. Skipping a nested read is required for
    /// Tokio's fair RwLock: a queued writer between two reads would otherwise
    /// wait on the outer read while the inner read waited on that writer. The
    /// supplied key is checked against the session before dispatch.
    pub(crate) async fn send_prompt_under_workspace_lease(
        &self,
        leased_workspace_id: &str,
        session_id: &str,
        blocks: Vec<PromptInputBlock>,
        prompt_id: Option<String>,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        self.send_prompt_with_lease_mode(
            session_id,
            blocks,
            prompt_id,
            PromptWorkspaceLeaseMode::AlreadyHeld(leased_workspace_id),
        )
        .await
    }

    async fn send_prompt_with_lease_mode(
        &self,
        session_id: &str,
        blocks: Vec<PromptInputBlock>,
        prompt_id: Option<String>,
        lease_mode: PromptWorkspaceLeaseMode<'_>,
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

        let (record, _workspace_lease) = self.resolve_prompt_record(session_id, lease_mode).await?;

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
        // under the abort policy returns here and the turn never starts. Unlike
        // the two text-prompt sites (which carry no attachments), this site has
        // already persisted `prepared`'s attachments, so an abort must clean them
        // up first — same discipline as the EnqueueFailed / ProductContextUnavailable
        // arms below (cleanup error ignored, exactly as they do).
        let checkpoint_id = match self
            .capture_turn_start_checkpoint(
                &record.workspace_id,
                session_id,
                &handle,
                prompt_id_for_trace.as_deref(),
            )
            .await
        {
            Ok(checkpoint_id) => checkpoint_id,
            Err(error) => {
                let _ = prepared.cleanup_attachments(
                    self.session_service.store(),
                    self.session_service.attachment_storage(),
                    session_id,
                );
                return Err(error);
            }
        };

        // Invariant 1/2: the actor is the sole writer of `busy` and the queue.
        // The runtime no longer precaptures `busy`; it just forwards the command
        // and awaits the actor's decision (Started vs Queued).
        let command_outcome = handle
            .send_prompt(prepared.payload.clone(), prompt_id)
            .await;
        self.settle_turn_start_checkpoint(checkpoint_id, &command_outcome)
            .await;
        let acceptance = command_outcome.map_err(|error| match error {
            LiveSessionCommandError::ActorUnavailable => {
                let _ = prepared.cleanup_attachments(
                    self.session_service.store(),
                    self.session_service.attachment_storage(),
                    session_id,
                );
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
            LiveSessionCommandError::Rejected(PromptAcceptError::ProductContextUnavailable {
                incident_id,
                error,
            }) => {
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
    #[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
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
            PromptWorkspaceLeaseMode::Acquire,
        )
        .await
    }

    /// Creation-only variant carrying trusted agent-session provenance without
    /// activating the general cross-agent message surface. The supplied key is
    /// checked against the new session before dispatch.
    pub(crate) async fn send_text_prompt_with_id_and_provenance_under_workspace_lease(
        &self,
        leased_workspace_id: &str,
        session_id: &str,
        text: String,
        prompt_id: String,
        provenance: PromptProvenance,
    ) -> Result<SendPromptOutcome, TextPromptDispatchError> {
        self.send_text_prompt_with_id_inner(
            session_id,
            text,
            prompt_id,
            Some(provenance),
            PromptWorkspaceLeaseMode::AlreadyHeld(leased_workspace_id),
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
            PromptWorkspaceLeaseMode::Acquire,
        )
        .await
    }

    async fn send_text_prompt_with_id_inner(
        &self,
        session_id: &str,
        text: String,
        prompt_id: String,
        provenance: Option<PromptProvenance>,
        lease_mode: PromptWorkspaceLeaseMode<'_>,
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
        self.send_payload_prompt_with_id(session_id, payload, prompt_id, lease_mode)
            .await
    }

    async fn send_payload_prompt_with_id(
        &self,
        session_id: &str,
        payload: crate::domains::sessions::prompt::PromptPayload,
        prompt_id: String,
        lease_mode: PromptWorkspaceLeaseMode<'_>,
    ) -> Result<SendPromptOutcome, TextPromptDispatchError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| {
                TextPromptDispatchError::Dispatch(SendPromptError::Internal(anyhow::anyhow!(
                    error.to_string()
                )))
            })?;
        let (record, _workspace_lease) = self
            .resolve_prompt_record(session_id, lease_mode)
            .await
            .map_err(TextPromptDispatchError::Dispatch)?;
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
        let command_outcome = handle.send_prompt(payload, Some(prompt_id)).await;
        self.settle_turn_start_checkpoint(checkpoint_id, &command_outcome)
            .await;
        let acceptance = command_outcome.map_err(classify_text_prompt_command_error)?;
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
        self.send_text_prompt_with_provenance_inner(
            session_id,
            text,
            provenance,
            PromptWorkspaceLeaseMode::Acquire,
            None,
        )
        .await
    }

    /// Provenance-bearing prompt twin for a caller that already owns the
    /// session workspace's shared operation lease.
    pub(crate) async fn send_text_prompt_with_provenance_under_workspace_lease(
        &self,
        leased_workspace_id: &str,
        session_id: &str,
        text: String,
        provenance: PromptProvenance,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        self.send_text_prompt_with_provenance_inner(
            session_id,
            text,
            provenance,
            PromptWorkspaceLeaseMode::AlreadyHeld(leased_workspace_id),
            None,
        )
        .await
    }

    /// Live-only prompt twin for schedulers that already resolved the exact
    /// actor allowed to receive this command. The handle is never replaced or
    /// cold-started while this method waits on workspace coordination.
    pub(crate) async fn send_text_prompt_with_provenance_on_existing_handle(
        &self,
        session_id: &str,
        text: String,
        provenance: PromptProvenance,
        handle: std::sync::Arc<crate::live::sessions::LiveSessionHandle>,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        self.send_text_prompt_with_provenance_inner(
            session_id,
            text,
            provenance,
            PromptWorkspaceLeaseMode::Acquire,
            Some(handle),
        )
        .await
    }

    async fn send_text_prompt_with_provenance_inner(
        &self,
        session_id: &str,
        text: String,
        provenance: PromptProvenance,
        lease_mode: PromptWorkspaceLeaseMode<'_>,
        existing_handle: Option<std::sync::Arc<crate::live::sessions::LiveSessionHandle>>,
    ) -> Result<SendPromptOutcome, SendPromptError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| SendPromptError::Internal(anyhow::anyhow!(error.to_string())))?;
        if text.trim().is_empty() {
            return Err(SendPromptError::EmptyPrompt);
        }
        let (record, _workspace_lease) = self.resolve_prompt_record(session_id, lease_mode).await?;
        let handle = match existing_handle {
            Some(handle) if handle.session_id == session_id => handle,
            Some(_) => {
                return Err(SendPromptError::Internal(anyhow::anyhow!(
                    "existing prompt handle does not match the target session"
                )))
            }
            None => self
                .ensure_live_session_handle(&record, None)
                .await
                .map_err(map_start_error_to_prompt)?,
        };
        // Turn-start checkpoint (Lane H) before dispatch.
        let checkpoint_id = self
            .capture_turn_start_checkpoint(&record.workspace_id, session_id, &handle, None)
            .await?;
        let payload =
            crate::domains::sessions::prompt::PromptPayload::text(text).with_provenance(provenance);
        let command_outcome = handle.send_prompt(payload, None).await;
        self.settle_turn_start_checkpoint(checkpoint_id, &command_outcome)
            .await;
        let acceptance = command_outcome.map_err(|error| match error {
            LiveSessionCommandError::ActorUnavailable => {
                SendPromptError::Internal(anyhow::anyhow!("session actor channel closed"))
            }
            LiveSessionCommandError::ResponseDropped => {
                SendPromptError::Internal(anyhow::anyhow!("session actor dropped response"))
            }
            LiveSessionCommandError::Rejected(PromptAcceptError::EnqueueFailed(detail)) => {
                SendPromptError::Internal(anyhow::anyhow!("failed to enqueue prompt: {detail}"))
            }
            LiveSessionCommandError::Rejected(PromptAcceptError::ProductContextUnavailable {
                incident_id,
                error,
            }) => SendPromptError::ProductContextUnavailable { incident_id, error },
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

pub(super) fn map_lifecycle_error_to_prompt(error: SessionLifecycleError) -> SendPromptError {
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
        StartSessionError::WorkspaceDirectoryMissing { path } => {
            SendPromptError::WorkspaceDirectoryMissing { path }
        }
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            SendPromptError::Internal(anyhow::anyhow!("agent descriptor not found: {agent_kind}"))
        }
        StartSessionError::LaunchOptionsUnavailable { agent_kind, state } => {
            SendPromptError::InvalidPrompt(
                crate::domains::sessions::prompt::PromptValidationError::new(
                    "SESSION_LAUNCH_OPTIONS_UNAVAILABLE",
                    format!(
                        "launch options are not available for agent '{agent_kind}' (state: {state:?})"
                    ),
                ),
            )
        }
        StartSessionError::LaunchValueUnsupported {
            agent_kind,
            key,
            value,
            state,
        } => SendPromptError::InvalidPrompt(
            crate::domains::sessions::prompt::PromptValidationError::new(
                "SESSION_LAUNCH_VALUE_UNSUPPORTED",
                format!(
                    "launch value '{value}' for '{key}' is no longer supported for agent '{agent_kind}' (state: {state:?})"
                ),
            ),
        ),
        StartSessionError::AgentEnvOverrideUnsupported {
            agent_kind,
            env_var_name,
        } => SendPromptError::InvalidPrompt(
            crate::domains::sessions::prompt::PromptValidationError::new(
                "SESSION_AGENT_ENV_OVERRIDE_UNSUPPORTED",
                format!(
                    "workspace/session environment cannot override agent-owned key '{env_var_name}' for '{agent_kind}'"
                ),
            ),
        ),
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
