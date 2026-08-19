use anyharness_contract::v1::{ForkSessionTarget, SessionExecutionPhase};
use sha2::{Digest, Sha256};

use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::model::{
    parse_action_capabilities, ForkOperationPhase, ForkOperationRecord, SessionRecord,
};
use crate::domains::sessions::runtime::fork_boundary;
use crate::domains::sessions::store::fork_operations::ForkOperationChildResult;
use crate::live::sessions::{ForkSessionCommandResult, SessionStartupStrategy};

use self::errors::{map_fork_target_error, map_live_fork_command_error, map_start_error_to_fork};
use self::native_anchor::{fork_child_provenance, resolve_native_provider_anchor};
use self::sidedoor::map_live_sidedoor_fork_error;

use super::startup_errors::map_start_session_error_to_anyhow;
use super::{
    ForkSessionError, ForkSessionOutcome, SessionLifecycleError, SessionRuntime, StartSessionError,
};

mod checkpoint_linkage;
mod errors;
mod native_anchor;
mod sidedoor;

impl SessionRuntime {
    pub async fn fork_session(
        &self,
        session_id: &str,
        target: Option<ForkSessionTarget>,
        requested_child_id: Option<String>,
        idempotency_key_header: Option<String>,
    ) -> Result<ForkSessionOutcome, ForkSessionError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| ForkSessionError::Internal(anyhow::anyhow!(error.to_string())))?;

        // Forks ADR rung 2 (ruling Q1): `item_id` is required at the product
        // boundary. Checked before anything else — it is a request-shape error
        // independent of the agent's capabilities.
        if let Some(target) = target.as_ref() {
            let has_item_id = target
                .item_id
                .as_deref()
                .map(str::trim)
                .is_some_and(|value| !value.is_empty());
            if !has_item_id {
                return Err(ForkSessionError::InvalidForkTarget(
                    "fork target requires item_id".to_string(),
                ));
            }
        }

        let parent = self.get_fork_parent(session_id)?;
        validate_fork_parent(&parent, &self.session_link_service)?;
        self.assert_fork_workspace_checkout_present(&parent.workspace_id)?;

        let capabilities = parse_action_capabilities(parent.action_capabilities_json.as_deref());
        if !capabilities.fork {
            return Err(unsupported_fork("session agent does not advertise fork support"));
        }
        if target.is_some() && !capabilities.targeted_fork {
            return Err(unsupported_fork("targeted fork is not supported by this agent"));
        }
        // --- Idempotency identity + canonical request digest (ADR 4.4) ---
        let reserved_child_id = requested_child_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let idempotency_key = requested_child_id
            .or(idempotency_key_header)
            .unwrap_or_else(|| reserved_child_id.clone());
        let request_digest = canonical_fork_request_digest(session_id, target.as_ref());

        if let Some(existing) = self
            .session_service
            .store()
            .find_fork_operation_by_key(&idempotency_key)
            .map_err(ForkSessionError::Internal)?
        {
            return self.reconcile_existing_fork_operation(&existing, &request_digest);
        }

        // Resolve and record the boundary. A resolved target never silently
        // degrades to a tip fork: it dispatches at the recorded anchor or errors.
        let parent_events = self
            .session_service
            .store()
            .list_events(session_id)
            .map_err(ForkSessionError::Internal)?;
        let (anchor_turn_id, anchor_item_id, prefix_terminal_seq, prefix_digest) =
            match target.as_ref() {
                Some(target) => {
                    let resolved = fork_boundary::resolve_targeted_boundary(&parent_events, target)
                        .map_err(map_fork_target_error)?;
                    (
                        Some(resolved.anchor_turn_id),
                        Some(resolved.anchor_item_id),
                        resolved.prefix_terminal_seq,
                        resolved.prefix_digest,
                    )
                }
                None => {
                    let tip = fork_boundary::tip_boundary(&parent_events);
                    (None, None, tip.prefix_terminal_seq, tip.prefix_digest)
                }
            };

        // Derive before live start; OpenCode resolves its vendor anchor downstream.
        let provider_anchor = resolve_native_provider_anchor(
            target.is_some(),
            &parent.agent_kind,
            &parent_events,
            prefix_terminal_seq,
        )?;

        let handle = self
            .ensure_live_session_handle(&parent, None)
            .await
            .map_err(map_start_error_to_fork)?;
        let parent = self.get_fork_parent(session_id)?;
        validate_fork_parent(&parent, &self.session_link_service)?;
        // Stale targeted readiness must fail before allocation or anchored dispatch.
        let capabilities = parse_action_capabilities(parent.action_capabilities_json.as_deref());
        if !capabilities.fork {
            return Err(unsupported_fork("session agent does not advertise fork support"));
        }
        if target.is_some() && !capabilities.targeted_fork {
            return Err(unsupported_fork("targeted fork is not supported by this agent"));
        }
        let parent_native_session_id = handle
            .native_session_id()
            .or_else(|| parent.native_session_id.clone())
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or(ForkSessionError::MissingNativeSessionId)?;
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
            || handle.is_busy()
        {
            return Err(ForkSessionError::Busy);
        }

        // Native and OpenCode side-door anchors are mutually exclusive. Skip
        // side-door resolution once the native anchor has been derived.
        let sidedoor_message_id: Option<String> = if provider_anchor.is_some() {
            None
        } else {
            self.resolve_sidedoor_message_id(
                session_id,
                target.is_some(),
                &parent,
                capabilities.targeted_fork,
                &anchor_turn_id,
                &anchor_item_id,
            )?
        };
        // The resolved vendor version for side-door provenance (never
        // hardcoded): the exact `(adapter, native)` pin this session was
        // stamped under.
        let sidedoor_native_version =
            self.resolve_sidedoor_native_version(session_id, &sidedoor_message_id);

        let checkpoint_id = checkpoint_linkage::find_exact(
            &self.checkpoint_service,
            &parent.id,
            anchor_turn_id.as_deref(),
        );

        // --- Persist the durable operation in `prepared` before any native call ---
        let now = chrono::Utc::now().to_rfc3339();
        let operation = ForkOperationRecord {
            id: uuid::Uuid::new_v4().to_string(),
            idempotency_key: idempotency_key.clone(),
            request_digest,
            parent_session_id: parent.id.clone(),
            child_session_id: reserved_child_id.clone(),
            phase: ForkOperationPhase::Prepared,
            anchor_turn_id,
            anchor_item_id,
            provider_anchor_kind: None,
            provider_anchor_value: None,
            provider_anchor_inclusive: None,
            prefix_terminal_seq: Some(prefix_terminal_seq),
            prefix_digest: Some(prefix_digest.clone()),
            adapter_version: None,
            native_version: None,
            native_child_session_id: None,
            checkpoint_id,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        // find-then-insert has a TOCTOU window (near-unreachable behind the
        // per-session fork lease): a concurrent request with the same key may
        // have inserted the row after our lookup. The UNIQUE constraint on
        // `idempotency_key`/`child_session_id` is the real guard — on a
        // constraint failure, re-read the winner and reconcile it (same-payload
        // resume, different-payload IDEMPOTENCY_CONFLICT) rather than 500.
        if let Err(error) = self
            .session_service
            .store()
            .insert_fork_operation(&operation)
        {
            if let Some(existing) = self
                .session_service
                .store()
                .find_fork_operation_by_key(&idempotency_key)
                .map_err(ForkSessionError::Internal)?
            {
                return self
                    .reconcile_existing_fork_operation(&existing, &operation.request_digest);
            }
            return Err(ForkSessionError::Internal(error));
        }

        // Must stay in lockstep with the resume-side strategy: a child forked on
        // the child actor (process-local fork id) is the one that can later land
        // in the zero-turn "stale native id" state handled by `launch_policy`.
        let child_actor_forks = super::launch_policy::fork_id_is_process_local(&parent.agent_kind);
        // Phase marked before dispatch (ADR 4.4): a lost native outcome parks the
        // record at `native_outcome_unknown` and blocks blind redispatch.
        self.mark_fork_phase(&operation.id, ForkOperationPhase::NativeCallInFlight, &now);
        let forked = if let Some(message_id) = sidedoor_message_id.clone() {
            // Side-door targeted fork: validated + POSTed on the parent actor.
            // The vendor fork response id becomes the child's durable native
            // session id; the child starts via the existing load_session path.
            match handle.sidedoor_targeted_fork(message_id).await {
                Ok(result) => Some(ForkSessionCommandResult {
                    native_session_id: result.native_session_id,
                    supports_close: result.supports_close,
                }),
                Err(error) => {
                    self.mark_fork_sidedoor_failure(&operation.id, &error, &now);
                    return Err(map_live_sidedoor_fork_error(error));
                }
            }
        } else if child_actor_forks {
            match handle.verify_fork_ready().await {
                Ok(()) => None,
                Err(error) => {
                    self.mark_fork_native_failure(&operation.id, &error, &now);
                    return Err(map_live_fork_command_error(
                        error,
                        "session actor dropped fork readiness response",
                    ));
                }
            }
        } else {
            match handle.fork(provider_anchor.clone()).await {
                Ok(forked) => Some(forked),
                Err(error) => {
                    self.mark_fork_native_failure(&operation.id, &error, &now);
                    return Err(map_live_fork_command_error(
                        error,
                        "session actor dropped fork response",
                    ));
                }
            }
        };

        let child = SessionRecord {
            id: reserved_child_id.clone(),
            workspace_id: parent.workspace_id.clone(),
            agent_kind: parent.agent_kind.clone(),
            native_session_id: forked
                .as_ref()
                .map(|forked| forked.native_session_id.clone()),
            // Forks inherit the parent's launch selection wholesale; the
            // classified-context provenance rides along with it.
            agent_auth_contexts: parent.agent_auth_contexts.clone(),
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
            public_id: Some(crate::domains::sessions::links::service::new_public_id(
                SessionLinkRelation::Fork,
            )),
            relation: SessionLinkRelation::Fork,
            parent_session_id: parent.id.clone(),
            child_session_id: child.id.clone(),
            workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
            label: None,
            created_by_turn_id: None,
            created_by_tool_call_id: None,
            created_at: now.clone(),
            subagent_closed_at: None,
            closed_at: None,
        };
        // Provenance resolved once the native call returns; applied atomically
        // with the child + link, advancing the operation to `child_persisted`
        // (see `native_anchor::fork_child_provenance`: side-door vendor id,
        // ACP-native derived anchor, or the tip marker — never the parent id).
        let (
            provider_anchor_kind,
            provider_anchor_value,
            provider_anchor_inclusive,
            resolved_native_version,
        ) = fork_child_provenance(
            sidedoor_message_id.as_deref(),
            sidedoor_native_version.as_deref(),
            provider_anchor.as_ref(),
        );
        let child_result = ForkOperationChildResult {
            provider_anchor_kind,
            provider_anchor_value,
            provider_anchor_inclusive,
            prefix_terminal_seq: Some(prefix_terminal_seq),
            prefix_digest: Some(prefix_digest.clone()),
            adapter_version: None,
            native_version: resolved_native_version,
            native_child_session_id: forked
                .as_ref()
                .map(|forked| forked.native_session_id.clone()),
        };
        let insert_result = self
            .session_service
            .store()
            .insert_fork_child_with_link_and_operation(
                &child,
                &link,
                &operation.id,
                &child_result,
                child_actor_forks,
                &now,
            );
        match &insert_result {
            Ok(copied_events) if child_actor_forks => {
                tracing::info!(
                    parent_session_id = %parent.id,
                    child_session_id = %child.id,
                    copied_events,
                    "snapshotted parent transcript into fork child"
                );
            }
            _ => {}
        }
        if let Err(error) = insert_result {
            self.mark_fork_phase(&operation.id, ForkOperationPhase::Failed, &now);
            if let Some(forked) = forked.as_ref().filter(|forked| forked.supports_close) {
                let _ = handle
                    .close_native_session(forked.native_session_id.clone())
                    .await;
            }
            return Err(ForkSessionError::Internal(error));
        }

        let child_loaded_from_forked_native_id = forked.is_some();
        let startup_strategy = if let Some(forked) = forked {
            SessionStartupStrategy::LoadNativeNoFallback(forked.native_session_id)
        } else {
            SessionStartupStrategy::ForkFromNative {
                parent_native_session_id,
                provider_anchor: provider_anchor.clone(),
            }
        };

        match self
            .start_live_session(&child, startup_strategy, child.system_prompt_append.clone())
            .await
        {
            Ok((_handle, native_session_id)) => {
                self.persist_live_session_state(&child.id, &native_session_id);
                self.mark_fork_phase(&operation.id, ForkOperationPhase::Completed, &now);
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
                    let cleared_at = chrono::Utc::now().to_rfc3339();
                    let _ = self
                        .session_service
                        .store()
                        .clear_native_session_id(&child.id, &cleared_at);
                }
                // The child row exists and is a first-class resumable state
                // (`FORK_CHILD_START_FAILED`); the operation stays at
                // `child_persisted`, not `failed` — the child, not the fork
                // dispatch, is what failed.
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

    fn get_fork_parent(&self, session_id: &str) -> Result<SessionRecord, ForkSessionError> {
        self.get_session_or_not_found(session_id)
            .map_err(|error| match error {
                SessionLifecycleError::SessionNotFound(session_id) => {
                    ForkSessionError::SessionNotFound(session_id)
                }
                SessionLifecycleError::Internal(error) => ForkSessionError::Internal(error),
            })
    }

    /// Best-effort phase advance; a failure to record the phase is logged, never
    /// fatal to the fork (the record is provenance/recovery metadata, not the
    /// child's source of truth).
    fn mark_fork_phase(&self, operation_id: &str, phase: ForkOperationPhase, now: &str) {
        if let Err(error) =
            self.session_service
                .store()
                .mark_fork_operation_phase(operation_id, phase, now)
        {
            tracing::warn!(
                operation_id = %operation_id,
                phase = phase.as_str(),
                error = %error,
                "failed to advance fork operation phase"
            );
        }
    }

    /// Reconcile a fork operation that already exists under this idempotency
    /// key: a different canonical payload is an `IDEMPOTENCY_CONFLICT`; the same
    /// payload resumes. Shared by the initial lookup and the insert-time
    /// UNIQUE-constraint TOCTOU fallback so both honor identical semantics.
    fn reconcile_existing_fork_operation(
        &self,
        existing: &ForkOperationRecord,
        request_digest: &str,
    ) -> Result<ForkSessionOutcome, ForkSessionError> {
        if existing.request_digest != request_digest {
            return Err(ForkSessionError::IdempotencyConflict);
        }
        self.resume_fork_operation(existing)
    }

    /// Resume an existing fork operation found by idempotency key (same payload).
    /// A parked/in-flight record whose native outcome is unknown blocks
    /// redispatch; a persisted child is returned as-is.
    fn resume_fork_operation(
        &self,
        operation: &ForkOperationRecord,
    ) -> Result<ForkSessionOutcome, ForkSessionError> {
        use ForkOperationPhase::*;
        match operation.phase {
            NativeOutcomeUnknown | Prepared | NativeCallInFlight | NativeResultKnown => {
                // No proven child: refuse to re-dispatch on the same key.
                Err(ForkSessionError::NativeOutcomeUnknown)
            }
            ChildPersisted | Completed | Failed => {
                let child = self
                    .session_service
                    .get_session(&operation.child_session_id)
                    .map_err(ForkSessionError::Internal)?
                    .ok_or_else(|| {
                        ForkSessionError::Internal(anyhow::anyhow!(
                            "fork operation child session missing: {}",
                            operation.child_session_id
                        ))
                    })?;
                let link = self
                    .session_link_service
                    .list_by_child(&operation.child_session_id)
                    .map_err(ForkSessionError::Internal)?
                    .into_iter()
                    .find(|link| {
                        link.relation == SessionLinkRelation::Fork
                            && link.parent_session_id == operation.parent_session_id
                    })
                    .ok_or_else(|| {
                        ForkSessionError::Internal(anyhow::anyhow!(
                            "fork operation child link missing: {}",
                            operation.child_session_id
                        ))
                    })?;
                let child_started = child.status != "error" && child.status != "starting";
                Ok(ForkSessionOutcome {
                    session: child,
                    link,
                    child_started,
                })
            }
        }
    }
}

fn unsupported_fork(message: &str) -> ForkSessionError {
    ForkSessionError::Unsupported(message.to_string())
}

/// Canonical fork request digest: binds an idempotency key to the exact request
/// so a repeat with the same key + payload resumes and a different payload
/// conflicts (ADR 4.4).
pub(crate) fn canonical_fork_request_digest(
    session_id: &str,
    target: Option<&ForkSessionTarget>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(session_id.as_bytes());
    hasher.update([0u8]);
    match target {
        None => hasher.update(b"tip"),
        Some(target) => {
            hasher.update(b"before_user_message");
            hasher.update([0u8]);
            hasher.update(target.turn_id.as_bytes());
            hasher.update([0u8]);
            hasher.update(target.item_id.as_deref().unwrap_or("").as_bytes());
        }
    }
    format!("{:x}", hasher.finalize())
}

impl SessionRuntime {
    /// Pre-flight the parent workspace's local checkout before forking. Reuses
    /// the shared `workspace_checkout_missing_path` admission (same predicate as
    /// session creation and the live-start seam) so a deleted checkout is
    /// refused before a fork child row is inserted. Remote/cloud-style
    /// workspaces are never blocked.
    fn assert_fork_workspace_checkout_present(
        &self,
        workspace_id: &str,
    ) -> Result<(), ForkSessionError> {
        if let Some(path) = self
            .workspace_checkout_missing_path(workspace_id)
            .map_err(ForkSessionError::Internal)?
        {
            return Err(ForkSessionError::WorkspaceDirectoryMissing { path });
        }
        Ok(())
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
