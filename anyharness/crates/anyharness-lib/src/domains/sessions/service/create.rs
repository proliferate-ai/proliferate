use std::path::Path;
use std::time::Instant;

use anyharness_contract::v1::AgentAuthExternalScope;
use uuid::Uuid;

use super::{CreateSessionError, SessionService};
use crate::domains::agents::auth_config::AgentAuthLaunchOverlayError;
use crate::domains::agents::catalog::projection::models::bundled_create_mode_ids;
use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agents::model_registry::resolution::{
    resolve_launch_model_id, ModelResolutionError,
};
use crate::domains::agents::readiness::resolver::resolve_agent_with_env;
use crate::domains::agents::registry::built_in_registry;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::workspaces::env::read_materialized_session_env;
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
        agent_auth_scope: Option<AgentAuthExternalScope>,
        required_agent_auth_revision: Option<i64>,
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
        let registry = built_in_registry();
        let descriptor = registry
            .iter()
            .find(|d| d.kind.as_str() == agent_kind)
            .ok_or_else(|| {
                CreateSessionError::Invalid(format!("unknown agent kind: {agent_kind}"))
            })?;
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            elapsed_ms = registry_lookup_started.elapsed().as_millis(),
            "[workspace-latency] session.create.agent_descriptor_found"
        );

        let workspace_env = read_materialized_session_env(Path::new(&workspace.path))
            .map_err(CreateSessionError::Internal)?;
        let agent_auth_overlay = self
            .agent_auth_config_service
            .launch_overlay(
                agent_kind,
                agent_auth_scope.as_ref(),
                required_agent_auth_revision,
            )
            .map_err(map_agent_auth_launch_error_to_create)?;
        let auth_support_env_keys: Vec<String> =
            agent_auth_overlay.support_env.keys().cloned().collect();
        let auth_protected_env_keys: Vec<String> =
            agent_auth_overlay.protected_env.keys().cloned().collect();
        let mut readiness_env = workspace_env.clone();
        readiness_env.extend(agent_auth_overlay.support_env);
        readiness_env.extend(agent_auth_overlay.protected_env);
        let agent_resolution_started = Instant::now();
        let resolved = resolve_agent_with_env(descriptor, &self.runtime_home, &readiness_env);
        if resolved.status != ResolvedAgentStatus::Ready {
            tracing::warn!(
                workspace_id = %workspace_id,
                agent_kind = %agent_kind,
                status = ?resolved.status,
                credential_state = ?resolved.credential_state,
                descriptor_auth_env_vars = ?descriptor.auth.expected_env_vars(),
                auth_support_env_keys = ?auth_support_env_keys,
                auth_protected_env_keys = ?auth_protected_env_keys,
                "Agent auth launch overlay did not satisfy agent readiness"
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
        let resolved_model_id = resolve_launch_model_id(
            &self.dynamic_model_registry_store,
            agent_kind,
            Some(workspace_id),
            model_id,
        )
        .map_err(CreateSessionError::Internal)?
        .map_err(|error| match error {
            ModelResolutionError::Unsupported(model_id) => CreateSessionError::ModelUnsupported {
                agent_kind: agent_kind.to_string(),
                model_id,
            },
            ModelResolutionError::Invalid(detail) => CreateSessionError::Invalid(detail),
        })?;
        let resolved_mode_id =
            resolve_mode_id(agent_kind, mode_id).map_err(|error| match error {
                ModeResolutionError::Unsupported(mode_id) => CreateSessionError::ModeUnsupported {
                    agent_kind: agent_kind.to_string(),
                    mode_id,
                },
                ModeResolutionError::Invalid(detail) => CreateSessionError::Invalid(detail),
            })?;
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            resolved_model_id = ?resolved_model_id,
            resolved_mode_id = ?resolved_mode_id,
            elapsed_ms = model_resolution_started.elapsed().as_millis(),
            "[workspace-latency] session.create.model_resolved"
        );

        let now = chrono::Utc::now().to_rfc3339();
        let record = SessionRecord {
            id: Uuid::new_v4().to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: agent_kind.to_string(),
            native_session_id: None,
            agent_auth_scope,
            required_agent_auth_revision,
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

fn map_agent_auth_launch_error_to_create(error: AgentAuthLaunchOverlayError) -> CreateSessionError {
    match error {
        AgentAuthLaunchOverlayError::SelectionRequired(required) => {
            CreateSessionError::AgentAuthSelectionRequired(required)
        }
        AgentAuthLaunchOverlayError::Internal(error) => CreateSessionError::Internal(error),
    }
}

#[derive(Debug)]
enum ModeResolutionError {
    Unsupported(String),
    Invalid(String),
}

fn resolve_mode_id(
    agent_kind: &str,
    provided_mode_id: Option<&str>,
) -> Result<Option<String>, ModeResolutionError> {
    let Some(mode_id) = provided_mode_id
        .map(str::trim)
        .filter(|mode_id| !mode_id.is_empty())
    else {
        return Ok(None);
    };
    let valid_ids = bundled_create_mode_ids(agent_kind).ok_or_else(|| {
        ModeResolutionError::Invalid(format!("mode catalog not found for agent '{agent_kind}'"))
    })?;
    if valid_ids.iter().any(|valid_id| valid_id == mode_id) {
        Ok(Some(mode_id.to_string()))
    } else {
        Err(ModeResolutionError::Unsupported(mode_id.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_create_session_mode_ids_against_bundled_catalog() {
        let resolved =
            resolve_mode_id("codex", Some("full-access")).expect("valid codex mode should resolve");
        assert_eq!(resolved.as_deref(), Some("full-access"));

        let error =
            resolve_mode_id("codex", Some("not-a-mode")).expect_err("invalid mode should fail");
        assert!(matches!(
            error,
            ModeResolutionError::Unsupported(mode_id) if mode_id == "not-a-mode"
        ));
    }
}
