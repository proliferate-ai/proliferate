use anyharness_contract::v1::SessionExecutionPhase;

use crate::domains::agents::model::AgentKind;
use crate::live::sessions::actor::command::{ForkSessionCommandError, SessionCommand};
use crate::live::sessions::actor::state::SessionStartupStrategy;
use crate::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::sessions::links::service::SessionLinkService;
use crate::sessions::model::{parse_action_capabilities, SessionRecord};

use super::startup::map_start_session_error_to_anyhow;
use super::{
    ForkSessionError, ForkSessionOutcome, SessionLifecycleError, SessionRuntime, StartSessionError,
};

impl SessionRuntime {
    pub async fn fork_session(
        &self,
        session_id: &str,
        target: Option<anyharness_contract::v1::ForkSessionTarget>,
    ) -> Result<ForkSessionOutcome, ForkSessionError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| ForkSessionError::Internal(anyhow::anyhow!(error.to_string())))?;
        if target.is_some() {
            return Err(ForkSessionError::Unsupported(
                "targeted fork is not enabled for this adapter".to_string(),
            ));
        }

        let parent = self
            .get_session_or_not_found(session_id)
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(session_id) => {
                    ForkSessionError::SessionNotFound(session_id)
                }
                SessionLifecycleError::Internal(error) => ForkSessionError::Internal(error),
            })?;

        validate_fork_parent(&parent, &self.session_link_service)?;

        let handle = self
            .ensure_live_session_handle(&parent, None, None)
            .await
            .map_err(map_start_error_to_fork)?;
        let parent = self
            .get_session_or_not_found(session_id)
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(session_id) => {
                    ForkSessionError::SessionNotFound(session_id)
                }
                SessionLifecycleError::Internal(error) => ForkSessionError::Internal(error),
            })?;
        validate_fork_parent(&parent, &self.session_link_service)?;
        let parent_native_session_id = handle
            .native_session_id()
            .or_else(|| parent.native_session_id.clone())
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or(ForkSessionError::MissingNativeSessionId)?;
        let capabilities = parse_action_capabilities(parent.action_capabilities_json.as_deref());
        if !capabilities.fork {
            return Err(ForkSessionError::Unsupported(
                "session agent does not advertise fork support".to_string(),
            ));
        }
        if !self
            .session_service
            .store()
            .list_pending_prompts(session_id)
            .map_err(ForkSessionError::Internal)?
            .is_empty()
        {
            return Err(ForkSessionError::Busy);
        }

        let execution = handle.execution_snapshot().await;
        if execution.phase != SessionExecutionPhase::Idle
            || !execution.pending_interactions.is_empty()
            || handle.busy.load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(ForkSessionError::Busy);
        }

        let child_actor_forks = parent.agent_kind == AgentKind::Claude.as_str();
        let forked = if child_actor_forks {
            let (tx, rx) = tokio::sync::oneshot::channel();
            handle
                .command_tx
                .send(SessionCommand::VerifyForkReady { respond_to: tx })
                .await
                .map_err(|_| {
                    ForkSessionError::Internal(anyhow::anyhow!("session actor channel closed"))
                })?;
            rx.await
                .map_err(|_| {
                    ForkSessionError::Internal(anyhow::anyhow!(
                        "session actor dropped fork readiness response"
                    ))
                })?
                .map_err(map_fork_command_error)?;
            None
        } else {
            let (tx, rx) = tokio::sync::oneshot::channel();
            handle
                .command_tx
                .send(SessionCommand::Fork { respond_to: tx })
                .await
                .map_err(|_| {
                    ForkSessionError::Internal(anyhow::anyhow!("session actor channel closed"))
                })?;
            Some(
                rx.await
                    .map_err(|_| {
                        ForkSessionError::Internal(anyhow::anyhow!(
                            "session actor dropped fork response"
                        ))
                    })?
                    .map_err(map_fork_command_error)?,
            )
        };

        let now = chrono::Utc::now().to_rfc3339();
        let child = SessionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: parent.workspace_id.clone(),
            agent_kind: parent.agent_kind.clone(),
            native_session_id: forked
                .as_ref()
                .map(|forked| forked.native_session_id.clone()),
            requested_model_id: parent.requested_model_id.clone(),
            current_model_id: parent.current_model_id.clone(),
            requested_mode_id: parent.requested_mode_id.clone(),
            current_mode_id: parent.current_mode_id.clone(),
            title: None,
            thinking_level_id: parent.thinking_level_id.clone(),
            thinking_budget_tokens: parent.thinking_budget_tokens,
            status: "starting".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: parent.mcp_bindings_ciphertext.clone(),
            mcp_binding_summaries_json: parent.mcp_binding_summaries_json.clone(),
            mcp_binding_policy: parent.mcp_binding_policy,
            system_prompt_append: parent.system_prompt_append.clone(),
            subagents_enabled: parent.subagents_enabled,
            action_capabilities_json: parent.action_capabilities_json.clone(),
            origin: parent.origin.clone(),
        };
        let link = SessionLinkRecord {
            id: uuid::Uuid::new_v4().to_string(),
            public_id: Some(crate::sessions::links::service::new_public_id(
                SessionLinkRelation::Fork,
            )),
            relation: SessionLinkRelation::Fork,
            parent_session_id: parent.id.clone(),
            child_session_id: child.id.clone(),
            workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
            label: None,
            created_by_turn_id: None,
            created_by_tool_call_id: None,
            created_at: now,
            closed_at: None,
        };
        let insert_result = if child_actor_forks {
            self.session_service
                .store()
                .insert_fork_session_with_link_and_event_snapshot(&child, &link)
                .map(|copied_events| {
                    tracing::info!(
                        parent_session_id = %parent.id,
                        child_session_id = %child.id,
                        copied_events,
                        "snapshotted parent transcript into fork child"
                    );
                })
        } else {
            self.session_service
                .store()
                .insert_session_with_link(&child, &link)
        };
        if let Err(error) = insert_result {
            if let Some(forked) = forked.as_ref().filter(|forked| forked.supports_close) {
                let (close_tx, close_rx) = tokio::sync::oneshot::channel();
                let _ = handle
                    .command_tx
                    .send(SessionCommand::CloseNativeSession {
                        native_session_id: forked.native_session_id.clone(),
                        respond_to: close_tx,
                    })
                    .await;
                let _ = close_rx.await;
            }
            return Err(ForkSessionError::Internal(error));
        }

        let child_loaded_from_forked_native_id = forked.is_some();
        let startup_strategy = if let Some(forked) = forked {
            SessionStartupStrategy::LoadNativeNoFallback(forked.native_session_id)
        } else {
            SessionStartupStrategy::ForkFromNative {
                parent_native_session_id,
            }
        };

        match self
            .start_live_session(
                &child,
                startup_strategy,
                child.system_prompt_append.clone(),
                None,
            )
            .await
        {
            Ok((_handle, native_session_id)) => {
                self.persist_live_session_state(&child.id, &native_session_id);
                let updated = self
                    .session_service
                    .get_session(&child.id)
                    .map_err(ForkSessionError::Internal)?
                    .unwrap_or(child);
                Ok(ForkSessionOutcome {
                    session: updated,
                    link,
                    child_started: true,
                })
            }
            Err(error) => {
                // If the native child id was persisted before failure, later
                // resumes should retry fork startup from the parent boundary instead
                // of looping forever on an ACP-side child id that did not load.
                if child_loaded_from_forked_native_id {
                    let now = chrono::Utc::now().to_rfc3339();
                    let _ = self
                        .session_service
                        .store()
                        .clear_native_session_id(&child.id, &now);
                }
                self.mark_session_errored(&child.id);
                let errored = self
                    .session_service
                    .get_session(&child.id)
                    .map_err(ForkSessionError::Internal)?
                    .unwrap_or(child);
                Err(ForkSessionError::StartFailed {
                    session: errored,
                    link,
                    error: map_start_session_error_to_anyhow(error),
                })
            }
        }
    }
}

pub(super) fn validate_fork_parent(
    parent: &SessionRecord,
    links: &SessionLinkService,
) -> Result<(), ForkSessionError> {
    if parent.closed_at.is_some() || parent.dismissed_at.is_some() || parent.status == "closed" {
        return Err(ForkSessionError::Invalid(
            "closed or dismissed sessions cannot be forked".to_string(),
        ));
    }
    let inbound = links
        .list_by_child(&parent.id)
        .map_err(ForkSessionError::Internal)?;
    if inbound
        .iter()
        .any(|link| link.relation != SessionLinkRelation::Fork)
    {
        return Err(ForkSessionError::Invalid(
            "linked child sessions cannot be forked".to_string(),
        ));
    }
    Ok(())
}

fn map_start_error_to_fork(error: StartSessionError) -> ForkSessionError {
    match error {
        StartSessionError::WorkspaceNotFound => {
            ForkSessionError::Internal(anyhow::anyhow!("workspace not found for session"))
        }
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            ForkSessionError::Internal(anyhow::anyhow!("agent descriptor not found: {agent_kind}"))
        }
        StartSessionError::Closed => ForkSessionError::Invalid("session is closed".to_string()),
        StartSessionError::MissingDataKey => ForkSessionError::MissingDataKey,
        StartSessionError::RestartRequired(detail) => ForkSessionError::Invalid(detail),
        StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
            ForkSessionError::Internal(error)
        }
    }
}

fn map_fork_command_error(error: ForkSessionCommandError) -> ForkSessionError {
    match error {
        ForkSessionCommandError::Busy => ForkSessionError::Busy,
        ForkSessionCommandError::Unsupported(detail) => ForkSessionError::Unsupported(detail),
        ForkSessionCommandError::Failed(detail) => {
            ForkSessionError::Internal(anyhow::anyhow!(detail))
        }
    }
}
