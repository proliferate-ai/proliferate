use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

use uuid::Uuid;

use super::{CreateSessionError, CreateSessionOutcome, SessionService};
use crate::domains::agents::launch_options::environment::find_capability_affecting_env_override;
use crate::domains::agents::launch_options::{
    HarnessLaunchOptionStateRow, LaunchSelection, LaunchSelectionUnsupported,
};
use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agents::readiness::service::resolve_launch_agent;
use crate::domains::agents::registry;
use crate::domains::sessions::adapter_migration::SessionAdapterMarker;
use crate::domains::sessions::launch_intent::ResolvedLaunchIntent;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::idempotent_create::InsertSessionByIdOutcome;
use crate::domains::workspaces::env::read_materialized_launch_env;
use crate::domains::workspaces::model::WorkspaceSurface;
use crate::origin::OriginContext;

impl SessionService {
    pub(crate) fn create_session(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        // Ruling 2b-1: a caller-preselected canonical UUID, so workflow
        // creation can reserve the session's mutation gate before this row
        // becomes visible. `None` mints here — the single minting path.
        preselected_session_id: Option<&str>,
        reuse_existing: bool,
        model_id: Option<&str>,
        control_values: &BTreeMap<String, String>,
        mcp_bindings_ciphertext: Option<String>,
        mcp_binding_summaries_json: Option<String>,
        mcp_binding_policy: SessionMcpBindingPolicy,
        system_prompt_append: Option<String>,
        subagents_enabled: bool,
        origin: OriginContext,
    ) -> Result<CreateSessionOutcome, CreateSessionError> {
        self.create_session_with_persist(
            workspace_id,
            agent_kind,
            preselected_session_id,
            reuse_existing,
            model_id,
            control_values,
            mcp_bindings_ciphertext,
            mcp_binding_summaries_json,
            mcp_binding_policy,
            system_prompt_append,
            subagents_enabled,
            origin,
            |record, intent, basis_revision, selection| {
                self.session_store
                    .insert_with_launch_intent(
                        record,
                        intent,
                        agent_kind,
                        basis_revision,
                        selection,
                    )
                    .map_err(|unsupported| {
                        map_selection_unsupported(
                            workspace_id,
                            preselected_session_id,
                            agent_kind,
                            unsupported,
                        )
                    })
            },
        )
    }

    /// The create use case itself. The observable entry point that wraps it
    /// is `create_session_with_persist` in `create_lifecycle.rs`.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn create_session_with_persist_inner<F>(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        preselected_session_id: Option<&str>,
        reuse_existing: bool,
        model_id: Option<&str>,
        control_values: &BTreeMap<String, String>,
        mcp_bindings_ciphertext: Option<String>,
        mcp_binding_summaries_json: Option<String>,
        mcp_binding_policy: SessionMcpBindingPolicy,
        system_prompt_append: Option<String>,
        subagents_enabled: bool,
        origin: OriginContext,
        persist_new: F,
    ) -> Result<CreateSessionOutcome, CreateSessionError>
    where
        F: FnOnce(
            &SessionRecord,
            &ResolvedLaunchIntent,
            &dyn Fn() -> String,
            &LaunchSelection,
        ) -> Result<HarnessLaunchOptionStateRow, CreateSessionError>,
    {
        let started = Instant::now();
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            model_id = ?model_id,
            control_ids = ?control_values.keys().collect::<Vec<_>>(),
            "[workspace-latency] session.create.validate.start"
        );

        let preselected_session_id = preselected_session_id
            .map(|id| validate_preselected_session_id(id, reuse_existing))
            .transpose()?;
        if reuse_existing && preselected_session_id.is_none() {
            return Err(CreateSessionError::Internal(anyhow::anyhow!(
                "reusing an existing session requires a preselected session id"
            )));
        }

        let workspace_lookup_started = Instant::now();
        let workspace = self
            .workspace_store
            .find_by_id(workspace_id)
            .map_err(CreateSessionError::Internal)?
            .ok_or_else(|| CreateSessionError::WorkspaceNotFound(workspace_id.to_string()))?;
        tracing::info!(
            workspace_id = %workspace_id,
            elapsed_ms = workspace_lookup_started.elapsed().as_millis(),
            "[workspace-latency] session.create.workspace_validated"
        );

        if workspace.surface == WorkspaceSurface::Cowork {
            if let Some(existing) = self
                .session_store
                .list_with_dismissed_by_workspace(workspace_id)
                .map_err(CreateSessionError::Internal)?
                .into_iter()
                .next()
            {
                if reuse_existing && preselected_session_id.as_deref() == Some(existing.id.as_str())
                {
                    // The idempotent request still passes every current create
                    // gate and the transactional request/intent comparison
                    // below. It is not a second Cowork session.
                } else {
                    return Err(CreateSessionError::WorkspaceSingleSession {
                        workspace_id: workspace_id.to_string(),
                        session_id: existing.id,
                    });
                }
            }
        }

        let registry_lookup_started = Instant::now();
        let descriptor = registry::descriptor(agent_kind).ok_or_else(|| {
            CreateSessionError::Invalid(format!("unknown agent kind: {agent_kind}"))
        })?;
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            elapsed_ms = registry_lookup_started.elapsed().as_millis(),
            "[workspace-latency] session.create.agent_descriptor_found"
        );

        let workspace_path = Path::new(&workspace.path);
        let readiness_env = read_materialized_launch_env(&self.runtime_home, workspace_path)
            .map_err(CreateSessionError::Internal)?;
        if let Some(env_var_name) =
            find_capability_affecting_env_override(&descriptor, &readiness_env)
        {
            return Err(CreateSessionError::AgentEnvOverrideUnsupported {
                agent_kind: agent_kind.to_string(),
                env_var_name: env_var_name.to_string(),
            });
        }

        let agent_resolution_started = Instant::now();
        // Fail closed BEFORE the readiness gate, so an unsatisfiable selection is
        // reported as the auth problem it is. The readiness gate would also refuse
        // this launch, but as "agent is not ready" — which reads to a user as "go
        // install something" when the real answer is "your gateway budget is
        // exhausted". agent-auth.md: a selection never silently degrades to the
        // user's personal credentials. Rotated: the create-time preview runs
        // the same seat-rotation decision as the launch (without advancing
        // anything), so an all-cooling pool 409s here with the cooling
        // sentence. The store rides the service's existing Db handle.
        let seat_cooling_store = crate::domains::agents::seat_cooling::SeatCoolingStore::new(
            self.session_store.db(),
        );
        if let Some(error) =
            crate::domains::agent_auth::route_auth::launch_route_selection_failure_rotated(
                &self.runtime_home,
                agent_kind,
                &seat_cooling_store,
            )
        {
            tracing::warn!(
                workspace_id = %workspace_id,
                agent_kind = %agent_kind,
                code = error.code(),
                error = %error,
                "agent-auth selection is unsatisfiable; refusing session create"
            );
            return Err(CreateSessionError::RouteAuth(error));
        }
        // Launch-time readiness: folds in the enrolled agent-auth route so a
        // gateway/api_key route makes the agent ready exactly as the launcher
        // will inject it (issue #1106) — no workspace-env credential workaround.
        let resolved = resolve_launch_agent(&descriptor, &self.runtime_home, &readiness_env);
        if resolved.status != ResolvedAgentStatus::Ready {
            tracing::warn!(
                workspace_id = %workspace_id,
                agent_kind = %agent_kind,
                status = ?resolved.status,
                credential_state = ?resolved.credential_state,
                descriptor_auth_env_vars = ?descriptor.auth.expected_env_vars(),
                "Agent readiness check failed for session create"
            );
            let detail = resolved.agent_process.message.clone().or_else(|| {
                resolved
                    .native
                    .as_ref()
                    .and_then(|artifact| artifact.message.clone())
            });
            if let Some(detail) = detail {
                return Err(CreateSessionError::Invalid(format!(
                    "agent '{agent_kind}' is not ready (status: {:?}): {detail}",
                    resolved.status
                )));
            }
            return Err(CreateSessionError::Invalid(format!(
                "agent '{agent_kind}' is not ready (status: {:?})",
                resolved.status
            )));
        }
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            elapsed_ms = agent_resolution_started.elapsed().as_millis(),
            "[workspace-latency] session.create.agent_validated"
        );

        let model_resolution_started = Instant::now();
        let selection = LaunchSelection {
            model_id: model_id.map(str::to_string),
            control_values: control_values.clone(),
        };
        let basis_revision = || self.launch_options_service.basis_revision(agent_kind);

        let session_id = preselected_session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = chrono::Utc::now().to_rfc3339();
        let intent = ResolvedLaunchIntent {
            model_id: selection.model_id.clone(),
            control_values: selection.control_values.clone(),
            created_at: now.clone(),
        };
        let record = SessionRecord {
            id: session_id,
            workspace_id: workspace_id.to_string(),
            agent_kind: agent_kind.to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "starting".into(),
            created_at: now.clone(),
            updated_at: now,
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext,
            mcp_binding_summaries_json,
            mcp_binding_policy,
            system_prompt_append,
            subagents_enabled,
            action_capabilities_json: None,
            origin: Some(origin),
        };

        let (outcome, validated_state) = if reuse_existing {
            let (insert_outcome, validated_state) = self
                .session_store
                .insert_or_find_by_id(&record, &intent, agent_kind, &basis_revision, &selection)
                .map_err(|unsupported| {
                    map_selection_unsupported(
                        workspace_id,
                        preselected_session_id.as_deref(),
                        agent_kind,
                        unsupported,
                    )
                })?;
            let outcome = match insert_outcome {
                InsertSessionByIdOutcome::Inserted => CreateSessionOutcome::Created(record),
                InsertSessionByIdOutcome::Existing {
                    record: existing,
                    intent: existing_intent,
                } => replay_existing_session(
                    existing,
                    existing_intent,
                    workspace_id,
                    agent_kind,
                    &selection,
                )?,
            };
            (outcome, validated_state)
        } else {
            let validated_state = persist_new(&record, &intent, &basis_revision, &selection)?;
            (CreateSessionOutcome::Created(record), validated_state)
        };
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            harness_basis_revision = %validated_state.basis_revision,
            source_revision = validated_state.revision,
            selected_model = selection.model_id.is_some(),
            selected_control_count = selection.control_values.len(),
            accepted = true,
            result_code = "accepted",
            event = "session.launch_selection.validated",
            elapsed_ms = model_resolution_started.elapsed().as_millis(),
            "[workspace-latency] session.create.model_resolved"
        );
        let record = match &outcome {
            CreateSessionOutcome::Created(record) | CreateSessionOutcome::Existing(record) => {
                record
            }
        };

        // Forks ADR R9 (rung 1c): stamp the adapter-migration marker with the
        // exact (adapter, native) versions this session was created under, so a
        // canonical-migrated session is distinguishable from a pinned
        // pre-migration one at reattach (the dual-read seam in
        // domains/sessions/adapter_migration.rs). Restamping an existing
        // (reused) session is skipped — it keeps its original provenance. A
        // stamp failure degrades to the legacy floor (absent marker) rather
        // than failing the create; it is logged for observability.
        if let CreateSessionOutcome::Created(_) = &outcome {
            let marker = SessionAdapterMarker::new(
                resolved.agent_process.version.clone(),
                resolved
                    .native
                    .as_ref()
                    .and_then(|native| native.version.clone()),
            );
            if let Err(error) =
                self.session_store
                    .upsert_adapter_marker(&record.id, &marker, &record.created_at)
            {
                tracing::warn!(
                    session_id = %record.id,
                    error = %error,
                    "failed to stamp session adapter-migration marker (R9)"
                );
            }
        }

        tracing::info!(
            workspace_id = %workspace_id,
            session_id = %record.id,
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] session.create.durable_record_inserted"
        );
        Ok(outcome)
    }
}

fn validate_preselected_session_id(
    id: &str,
    public_idempotent_create: bool,
) -> Result<String, CreateSessionError> {
    let invalid = || {
        if public_idempotent_create {
            CreateSessionError::Invalid(
                "sessionId must be a canonical lowercase v4 UUID".to_string(),
            )
        } else {
            CreateSessionError::Internal(anyhow::anyhow!(
                "preselected session id must be a canonical lowercase v4 UUID"
            ))
        }
    };
    let parsed = Uuid::parse_str(id).map_err(|_| invalid())?;
    if parsed.get_version_num() != 4 || id != parsed.hyphenated().to_string() {
        return Err(invalid());
    }
    Ok(id.to_string())
}

fn replay_existing_session(
    existing: SessionRecord,
    existing_intent: Option<ResolvedLaunchIntent>,
    workspace_id: &str,
    agent_kind: &str,
    selection: &LaunchSelection,
) -> Result<CreateSessionOutcome, CreateSessionError> {
    let request_matches_intent =
        request_matches_persisted_intent(existing_intent.as_ref(), selection);
    if existing.workspace_id != workspace_id
        || existing.agent_kind != agent_kind
        || !request_matches_intent
        || existing.closed_at.is_some()
        || existing.dismissed_at.is_some()
        || existing.status == "closed"
    {
        return Err(CreateSessionError::SessionIdConflict {
            session_id: existing.id,
        });
    }
    Ok(CreateSessionOutcome::Existing(existing))
}

fn request_matches_persisted_intent(
    intent: Option<&ResolvedLaunchIntent>,
    selection: &LaunchSelection,
) -> bool {
    intent.is_some_and(|intent| {
        intent.model_id == selection.model_id && intent.control_values == selection.control_values
    })
}

pub(crate) fn map_selection_unsupported(
    workspace_id: &str,
    attempted_session_id: Option<&str>,
    agent_kind: &str,
    unsupported: LaunchSelectionUnsupported,
) -> CreateSessionError {
    match unsupported {
        LaunchSelectionUnsupported::Internal(error) => {
            log_selection_rejected(
                workspace_id,
                attempted_session_id,
                agent_kind,
                None,
                "internal",
                None,
            );
            CreateSessionError::Internal(error)
        }
        LaunchSelectionUnsupported::ObservationUnavailable { state } => {
            log_selection_rejected(
                workspace_id,
                attempted_session_id,
                agent_kind,
                None,
                "observation_unavailable",
                state,
            );
            CreateSessionError::LaunchOptionsUnavailable {
                agent_kind: agent_kind.to_string(),
                state,
            }
        }
        LaunchSelectionUnsupported::Model { model_id, state } => {
            log_selection_rejected(
                workspace_id,
                attempted_session_id,
                agent_kind,
                Some("modelId"),
                "unsupported_model",
                Some(state),
            );
            CreateSessionError::LaunchValueUnsupported {
                agent_kind: agent_kind.to_string(),
                key: "modelId".to_string(),
                value: model_id,
                state,
            }
        }
        LaunchSelectionUnsupported::Control { control_id, state } => {
            log_selection_rejected(
                workspace_id,
                attempted_session_id,
                agent_kind,
                Some(&control_id),
                "unsupported_control",
                Some(state),
            );
            CreateSessionError::LaunchValueUnsupported {
                agent_kind: agent_kind.to_string(),
                key: control_id,
                value: "<unknown-control>".to_string(),
                state,
            }
        }
        LaunchSelectionUnsupported::ControlValue {
            control_id,
            value,
            state,
        } => {
            log_selection_rejected(
                workspace_id,
                attempted_session_id,
                agent_kind,
                Some(&control_id),
                "unsupported_control_value",
                Some(state),
            );
            CreateSessionError::LaunchValueUnsupported {
                agent_kind: agent_kind.to_string(),
                key: control_id,
                value,
                state,
            }
        }
    }
}

fn log_selection_rejected(
    workspace_id: &str,
    attempted_session_id: Option<&str>,
    agent_kind: &str,
    rejected_key: Option<&str>,
    result_code: &str,
    state: Option<crate::domains::agents::launch_options::HarnessLaunchOptionsState>,
) {
    tracing::info!(
        workspace_id,
        attempted_session_id,
        agent_kind,
        rejected_key,
        result_code,
        options_state = ?state,
        accepted = false,
        event = "session.launch_selection.validated",
        "session launch selection rejected"
    );
}

#[cfg(test)]
mod idempotent_intent_tests {
    use super::*;

    #[test]
    fn replay_requires_exact_model_and_complete_control_equality() {
        let intent = ResolvedLaunchIntent {
            model_id: Some("model-a".to_string()),
            control_values: BTreeMap::from([
                ("collaboration_mode".to_string(), "plan".to_string()),
                ("mode".to_string(), "agent-full-access".to_string()),
            ]),
            created_at: "2026-08-19T00:00:00Z".to_string(),
        };
        let exact = LaunchSelection {
            model_id: intent.model_id.clone(),
            control_values: intent.control_values.clone(),
        };
        assert!(request_matches_persisted_intent(Some(&intent), &exact));

        let mut changed_model = exact.clone();
        changed_model.model_id = Some("model-b".to_string());
        assert!(!request_matches_persisted_intent(
            Some(&intent),
            &changed_model
        ));

        let mut omitted_control = exact;
        omitted_control.control_values.remove("mode");
        assert!(!request_matches_persisted_intent(
            Some(&intent),
            &omitted_control
        ));
        assert!(!request_matches_persisted_intent(None, &omitted_control));
    }
}
