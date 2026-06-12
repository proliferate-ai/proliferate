use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyharness_contract::v1::AgentAuthExternalScope;
use anyharness_credential_discovery::CredentialFact;
use uuid::Uuid;

use super::{CreateSessionError, SessionService};
use crate::domains::agents::auth::context::classify;
use crate::domains::agents::auth::AgentAuthLaunchOverlayError;
use crate::domains::agents::catalog::projection::models::bundled_create_mode_ids;
use crate::domains::agents::catalog::service::{ActiveV2Catalog, SelectionUnsupported};
use crate::domains::agents::model::{AgentDescriptor, ResolvedAgentStatus};
use crate::domains::agents::model_registry::resolution::{
    resolve_launch_model_id, ModelResolutionError,
};
use crate::domains::agents::readiness::service::resolve_agent_with_env;
use crate::domains::agents::registry;
use crate::domains::agents::registry::bundled::bundled_agent_registry_document;
use crate::domains::agents::registry::schema::AgentRegistryEnvVarKind;
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
        let descriptor = registry::descriptor(agent_kind).ok_or_else(|| {
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
            .agent_auth_service
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
        let resolved = resolve_agent_with_env(&descriptor, &self.runtime_home, &readiness_env);
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
        // Dual-era gate: the v2 path activates only when the ACTIVE catalog
        // is a v2 document that knows this agent kind; otherwise the v1
        // resolution below runs unchanged.
        let v2_catalog = self
            .catalog_service
            .active_v2()
            .filter(|catalog| catalog.agent(agent_kind).is_some());
        let (resolved_model_id, resolved_mode_id, agent_auth_contexts) = match &v2_catalog {
            Some(catalog) => resolve_selection_v2(
                catalog,
                &descriptor,
                agent_kind,
                model_id,
                mode_id,
                &readiness_env,
            )?,
            None => {
                let resolved_model_id = resolve_launch_model_id(
                    &self.dynamic_model_registry_store,
                    agent_kind,
                    Some(workspace_id),
                    model_id,
                )
                .map_err(CreateSessionError::Internal)?
                .map_err(|error| match error {
                    ModelResolutionError::Unsupported(model_id) => {
                        CreateSessionError::ModelUnsupported {
                            agent_kind: agent_kind.to_string(),
                            model_id,
                        }
                    }
                    ModelResolutionError::Invalid(detail) => CreateSessionError::Invalid(detail),
                })?;
                let resolved_mode_id =
                    resolve_mode_id(agent_kind, mode_id).map_err(|error| match error {
                        ModeResolutionError::Unsupported(mode_id) => {
                            CreateSessionError::ModeUnsupported {
                                agent_kind: agent_kind.to_string(),
                                mode_id,
                            }
                        }
                        ModeResolutionError::Invalid(detail) => CreateSessionError::Invalid(detail),
                    })?;
                (resolved_model_id, resolved_mode_id, None)
            }
        };
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            resolved_model_id = ?resolved_model_id,
            resolved_mode_id = ?resolved_mode_id,
            catalog_era = if v2_catalog.is_some() { "v2" } else { "v1" },
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
            agent_auth_scope,
            required_agent_auth_revision,
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

/// The v2-era launch resolution (migration §5.5 T2): classify auth contexts
/// over the COMPOSED readiness env, then validate the selection through the
/// catalog read surface. Returns `(launch_model_id, mode_id, provenance)` —
/// provenance is the classified context ids as a JSON array, recorded on
/// the session ("why this menu").
fn resolve_selection_v2(
    catalog: &ActiveV2Catalog,
    descriptor: &AgentDescriptor,
    agent_kind: &str,
    model_id: Option<&str>,
    mode_id: Option<&str>,
    readiness_env: &BTreeMap<String, String>,
) -> Result<(Option<String>, Option<String>, Option<String>), CreateSessionError> {
    let contexts = catalog.auth_contexts(agent_kind).unwrap_or(&[]);
    let facts = collect_launch_env_facts(agent_kind, readiness_env);
    let active = classify(descriptor, contexts, &facts);
    let selection = catalog
        .validate_launch(agent_kind, &active, model_id, mode_id)
        .map_err(|unsupported| map_selection_unsupported(agent_kind, unsupported))?;
    let provenance =
        serde_json::to_string(active.ids()).map_err(|error| CreateSessionError::Internal(error.into()))?;
    Ok((
        selection.launch_model_id,
        selection.mode_id,
        Some(provenance),
    ))
}

/// Credential facts for classification, sourced from the composed launch
/// env — never the ambient process env (decisions ledger 8): env presence is
/// the readiness env key set; values are read only for registry-declared
/// flag vars.
fn collect_launch_env_facts(
    agent_kind: &str,
    readiness_env: &BTreeMap<String, String>,
) -> Vec<CredentialFact> {
    let env_keys: BTreeSet<String> = readiness_env.keys().cloned().collect();
    let mut flag_values: BTreeMap<String, String> = BTreeMap::new();
    if let Some(agent) = bundled_agent_registry_document()
        .agents
        .iter()
        .find(|agent| agent.kind == agent_kind)
    {
        for slot in &agent.auth.slots {
            for env_var in &slot.env_vars {
                if env_var.kind() != AgentRegistryEnvVarKind::Flag {
                    continue;
                }
                if let Some(value) = readiness_env.get(env_var.name()) {
                    flag_values.insert(env_var.name().to_string(), value.clone());
                }
            }
        }
    }
    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    anyharness_credential_discovery::collect_facts(&home_dir, &env_keys, &flag_values)
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
            CreateSessionError::ModelUnsupported {
                agent_kind: agent_kind.to_string(),
                model_id,
            }
        }
        SelectionUnsupported::UnsupportedMode { mode_id } => CreateSessionError::ModeUnsupported {
            agent_kind: agent_kind.to_string(),
            mode_id,
        },
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
