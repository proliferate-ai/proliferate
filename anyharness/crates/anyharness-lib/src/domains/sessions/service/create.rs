use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

use uuid::Uuid;

use super::{CreateSessionError, SessionService};
use crate::domains::agents::auth::context::classify;
use crate::domains::agents::auth::launch_facts::collect_launch_env_facts;
use crate::domains::agents::catalog::service::{ActiveCatalog, SelectionUnsupported};
use crate::domains::agents::model::{AgentDescriptor, ResolvedAgentStatus};
use crate::domains::agents::readiness::service::resolve_agent_with_env;
use crate::domains::agents::registry;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::workspaces::env::read_materialized_launch_env;
use crate::domains::workspaces::model::WorkspaceSurface;
use crate::origin::OriginContext;

impl SessionService {
    pub fn create_session(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        mcp_bindings_ciphertext: Option<String>,
        mcp_binding_summaries_json: Option<String>,
        mcp_binding_policy: SessionMcpBindingPolicy,
        system_prompt_append: Option<String>,
        subagents_enabled: bool,
        origin: OriginContext,
    ) -> Result<SessionRecord, CreateSessionError> {
        let started = Instant::now();
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            model_id = ?model_id,
            mode_id = ?mode_id,
            "[workspace-latency] session.create.validate.start"
        );

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
        let resolved = resolve_agent_with_env(&descriptor, &self.runtime_home, &readiness_env);
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

        let now = chrono::Utc::now().to_rfc3339();
        let record = SessionRecord {
            id: Uuid::new_v4().to_string(),
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

        self.session_store
            .insert(&record)
            .map_err(CreateSessionError::Internal)?;
        tracing::info!(
            workspace_id = %workspace_id,
            session_id = %record.id,
            elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] session.create.durable_record_inserted"
        );
        Ok(record)
    }
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
