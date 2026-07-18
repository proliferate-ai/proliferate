use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

use uuid::Uuid;

use super::{CreateSessionError, CreateSessionOutcome, SessionService};
use crate::domains::agents::auth::context::classify;
use crate::domains::agents::auth::launch_facts::collect_launch_env_facts;
use crate::domains::agents::catalog::service::{ActiveCatalog, SelectionUnsupported};
use crate::domains::agents::model::{AgentDescriptor, ResolvedAgentStatus};
use crate::domains::agents::readiness::service::resolve_launch_agent;
use crate::domains::agents::registry;
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
        mode_id: Option<&str>,
        mcp_bindings_ciphertext: Option<String>,
        mcp_binding_summaries_json: Option<String>,
        mcp_binding_policy: SessionMcpBindingPolicy,
        system_prompt_append: Option<String>,
        subagents_enabled: bool,
        origin: OriginContext,
    ) -> Result<CreateSessionOutcome, CreateSessionError> {
        let started = Instant::now();
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            model_id = ?model_id,
            mode_id = ?mode_id,
            "[workspace-latency] session.create.validate.start"
        );

        let preselected_session_id = preselected_session_id
            .map(|id| validate_preselected_session_id(id, reuse_existing))
            .transpose()?;
        if reuse_existing {
            let Some(session_id) = preselected_session_id.as_deref() else {
                return Err(CreateSessionError::Internal(anyhow::anyhow!(
                    "reusing an existing session requires a preselected session id"
                )));
            };
            if let Some(existing) = self
                .session_store
                .find_by_id(session_id)
                .map_err(CreateSessionError::Internal)?
            {
                return replay_existing_session(existing, workspace_id, agent_kind);
            }
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
                return Err(CreateSessionError::WorkspaceSingleSession {
                    workspace_id: workspace_id.to_string(),
                    session_id: existing.id,
                });
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

        let readiness_env =
            read_materialized_launch_env(&self.runtime_home, Path::new(&workspace.path))
                .map_err(CreateSessionError::Internal)?;
        let agent_resolution_started = Instant::now();
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
        let catalog = self.catalog_service.active_catalog();
        let (resolved_model_id, resolved_mode_id, agent_auth_contexts) = resolve_selection(
            &catalog,
            &descriptor,
            agent_kind,
            model_id,
            mode_id,
            &readiness_env,
            &self.runtime_home,
        )?;
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            resolved_model_id = ?resolved_model_id,
            resolved_mode_id = ?resolved_mode_id,
            agent_auth_contexts = ?agent_auth_contexts,
            elapsed_ms = model_resolution_started.elapsed().as_millis(),
            "[workspace-latency] session.create.model_resolved"
        );

        let session_id = preselected_session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = chrono::Utc::now().to_rfc3339();
        let record = SessionRecord {
            id: session_id,
            workspace_id: workspace_id.to_string(),
            agent_kind: agent_kind.to_string(),
            native_session_id: None,
            agent_auth_contexts,
            requested_model_id: resolved_model_id.clone(),
            current_model_id: resolved_model_id,
            requested_mode_id: resolved_mode_id.clone(),
            current_mode_id: resolved_mode_id,
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

        let outcome = if reuse_existing {
            match self
                .session_store
                .insert_or_find_by_id(&record)
                .map_err(CreateSessionError::Internal)?
            {
                InsertSessionByIdOutcome::Inserted => CreateSessionOutcome::Created(record),
                InsertSessionByIdOutcome::Existing(existing) => {
                    replay_existing_session(existing, workspace_id, agent_kind)?
                }
            }
        } else {
            self.session_store
                .insert(&record)
                .map_err(CreateSessionError::Internal)?;
            CreateSessionOutcome::Created(record)
        };
        let record = match &outcome {
            CreateSessionOutcome::Created(record) | CreateSessionOutcome::Existing(record) => {
                record
            }
        };
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
    workspace_id: &str,
    agent_kind: &str,
) -> Result<CreateSessionOutcome, CreateSessionError> {
    if existing.workspace_id != workspace_id
        || existing.agent_kind != agent_kind
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

/// Launch resolution: classify auth contexts over the COMPOSED readiness
/// env, then validate the selection through the catalog read surface.
/// Returns `(launch_model_id, mode_id, provenance)` — provenance is the
/// classified context ids as a JSON array, recorded on the session ("why
/// this menu").
fn resolve_selection(
    catalog: &ActiveCatalog,
    descriptor: &AgentDescriptor,
    agent_kind: &str,
    model_id: Option<&str>,
    mode_id: Option<&str>,
    readiness_env: &BTreeMap<String, String>,
    runtime_home: &Path,
) -> Result<(Option<String>, Option<String>, Option<String>), CreateSessionError> {
    let contexts = catalog.auth_contexts(agent_kind).unwrap_or(&[]);
    let facts = collect_launch_env_facts(agent_kind, readiness_env, runtime_home);
    let active = classify(descriptor, contexts, &facts);
    let selection = catalog
        .validate_launch(agent_kind, &active, model_id, mode_id)
        .map_err(|unsupported| map_selection_unsupported(agent_kind, unsupported))?;
    let provenance = serde_json::to_string(active.ids())
        .map_err(|error| CreateSessionError::Internal(error.into()))?;
    Ok((
        selection.launch_model_id,
        selection.mode_id,
        Some(provenance),
    ))
}

fn map_selection_unsupported(
    agent_kind: &str,
    unsupported: SelectionUnsupported,
) -> CreateSessionError {
    match unsupported {
        SelectionUnsupported::UnknownAgent { agent_kind } => {
            CreateSessionError::Invalid(format!("unknown agent kind: {agent_kind}"))
        }
        SelectionUnsupported::UnknownModel { model_id } => CreateSessionError::ModelUnsupported {
            agent_kind: agent_kind.to_string(),
            model_id,
        },
        SelectionUnsupported::ModelGated {
            model_id,
            required_contexts,
        } => {
            tracing::info!(
                agent_kind,
                model_id = %model_id,
                required_contexts = ?required_contexts,
                "session create rejected: model gated behind inactive auth contexts"
            );
            CreateSessionError::ModelGated {
                agent_kind: agent_kind.to_string(),
                model_id,
                required_contexts,
            }
        }
        SelectionUnsupported::UnsupportedMode { mode_id } => CreateSessionError::ModeUnsupported {
            agent_kind: agent_kind.to_string(),
            mode_id,
        },
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::app::{test_support, AppState};
    use crate::domains::agents::installer::seed::AgentSeedStore;
    use crate::persistence::Db;

    #[tokio::test(flavor = "current_thread")]
    async fn idempotent_create_reuses_only_the_original_workspace_and_agent() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _bearer_guard = test_support::set_bearer_token_env(None);
        let _data_key_guard = test_support::set_data_key_env(None);
        let state = AppState::new(
            std::env::temp_dir().join(format!(
                "anyharness-idempotent-session-create-{}",
                Uuid::new_v4()
            )),
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("open in-memory db"),
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("create app state");
        test_support::seed_workspace_with_repo_root(
            &state.db,
            "workspace-1",
            "local",
            "/tmp/workspace",
        );
        let session_id = "01234567-89ab-4def-8123-456789abcdef";
        state
            .session_service
            .store()
            .insert(&session_record(session_id))
            .expect("insert original session");

        let replay = state
            .session_service
            .create_session(
                "workspace-1",
                "claude",
                Some(session_id),
                true,
                None,
                None,
                None,
                None,
                SessionMcpBindingPolicy::InheritWorkspace,
                None,
                true,
                OriginContext::api_local_runtime(),
            )
            .expect("replay original create");
        assert!(
            matches!(replay, CreateSessionOutcome::Existing(record) if record.id == session_id)
        );
        assert_eq!(
            state
                .session_service
                .store()
                .list_by_workspace("workspace-1")
                .expect("list sessions")
                .len(),
            1
        );

        let conflict = state
            .session_service
            .create_session(
                "workspace-1",
                "codex",
                Some(session_id),
                true,
                None,
                None,
                None,
                None,
                SessionMcpBindingPolicy::InheritWorkspace,
                None,
                true,
                OriginContext::api_local_runtime(),
            )
            .expect_err("cross-agent id reuse must conflict");
        assert!(matches!(
            conflict,
            CreateSessionError::SessionIdConflict { session_id: id } if id == session_id
        ));

        state
            .session_service
            .store()
            .mark_dismissed(session_id, "2026-07-17T00:01:00Z")
            .expect("dismiss original session");
        let dismissed_conflict = state
            .session_service
            .create_session(
                "workspace-1",
                "claude",
                Some(session_id),
                true,
                None,
                None,
                None,
                None,
                SessionMcpBindingPolicy::InheritWorkspace,
                None,
                true,
                OriginContext::api_local_runtime(),
            )
            .expect_err("dismissed idempotency ownership must not replay");
        assert!(matches!(
            dismissed_conflict,
            CreateSessionError::SessionIdConflict { session_id: id } if id == session_id
        ));
    }

    fn session_record(id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "starting".to_string(),
            created_at: "2026-07-17T00:00:00Z".to_string(),
            updated_at: "2026-07-17T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: Some(OriginContext::api_local_runtime()),
        }
    }
}
