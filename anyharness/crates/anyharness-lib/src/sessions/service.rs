use std::time::Instant;

use uuid::Uuid;

use super::live_config::snapshot_from_record;
use super::model::{
    PendingConfigChangeRecord, PendingPromptRecord, SessionEventRecord,
    SessionLiveConfigSnapshotRecord, SessionRawNotificationRecord, SessionRecord,
};
use super::store::SessionStore;
use crate::agents::catalog::model_registries;
use crate::agents::model::{ModelRegistryMetadata, ResolvedAgentStatus};
use crate::agents::registry::built_in_registry;
use crate::agents::resolver::resolve_agent;
use crate::workspaces::store::WorkspaceStore;

pub struct SessionService {
    session_store: SessionStore,
    workspace_store: WorkspaceStore,
    runtime_home: std::path::PathBuf,
}

#[derive(Debug)]
pub enum CreateSessionError {
    WorkspaceNotFound(String),
    WorkspaceSingleSession {
        workspace_id: String,
        session_id: String,
    },
    Invalid(String),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum GetLiveConfigSnapshotError {
    SessionNotFound(String),
    Internal(anyhow::Error),
}

#[derive(Debug)]
pub enum UpdateSessionTitleError {
    SessionNotFound(String),
    EmptyTitle,
    TitleTooLong(usize),
    Internal(anyhow::Error),
}

#[derive(Debug, Clone)]
pub struct WorkspaceSessionLaunchModelData {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone)]
pub struct WorkspaceSessionLaunchAgentData {
    pub kind: String,
    pub display_name: String,
    pub default_model_id: Option<String>,
    pub models: Vec<WorkspaceSessionLaunchModelData>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceSessionLaunchCatalogData {
    pub workspace_id: String,
    pub agents: Vec<WorkspaceSessionLaunchAgentData>,
}

impl SessionService {
    pub fn new(
        session_store: SessionStore,
        workspace_store: WorkspaceStore,
        runtime_home: std::path::PathBuf,
    ) -> Self {
        Self {
            session_store,
            workspace_store,
            runtime_home,
        }
    }

    pub fn create_session(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        mcp_bindings_ciphertext: Option<String>,
        mcp_binding_summaries_json: Option<String>,
        system_prompt_append: Option<String>,
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

        if workspace.surface == "cowork" {
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

        let agent_resolution_started = Instant::now();
        let resolved = resolve_agent(descriptor, &self.runtime_home);
        if resolved.status != crate::agents::model::ResolvedAgentStatus::Ready {
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
        let registries = model_registries();
        let model_registry = find_model_registry(&registries, agent_kind)
            .map_err(|error| CreateSessionError::Invalid(error.to_string()))?;
        let resolved_model_id = resolve_model_id(model_registry, model_id)
            .map_err(|error| CreateSessionError::Invalid(error.to_string()))?;
        let resolved_mode_id = mode_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
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
            system_prompt_append,
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

    pub fn get_session(&self, id: &str) -> anyhow::Result<Option<SessionRecord>> {
        self.session_store.find_by_id(id)
    }

    pub fn list_sessions(
        &self,
        workspace_id: Option<&str>,
        include_dismissed: bool,
    ) -> anyhow::Result<Vec<SessionRecord>> {
        match (workspace_id, include_dismissed) {
            (Some(wid), false) => self.session_store.list_visible_by_workspace(wid),
            (Some(wid), true) => self.session_store.list_with_dismissed_by_workspace(wid),
            (None, false) => self.session_store.list_visible_all(),
            (None, true) => self.session_store.list_with_dismissed_all(),
        }
    }

    pub fn list_session_event_records(
        &self,
        session_id: &str,
        after_seq: Option<i64>,
    ) -> anyhow::Result<Option<Vec<SessionEventRecord>>> {
        if self.session_store.find_by_id(session_id)?.is_none() {
            return Ok(None);
        }

        match after_seq {
            Some(seq) => self
                .session_store
                .list_events_after(session_id, seq)
                .map(Some),
            None => self.session_store.list_events(session_id).map(Some),
        }
    }

    pub fn list_session_raw_notification_records(
        &self,
        session_id: &str,
        after_seq: Option<i64>,
    ) -> anyhow::Result<Option<Vec<SessionRawNotificationRecord>>> {
        if self.session_store.find_by_id(session_id)?.is_none() {
            return Ok(None);
        }

        match after_seq {
            Some(seq) => self
                .session_store
                .list_raw_notifications_after(session_id, seq)
                .map(Some),
            None => self
                .session_store
                .list_raw_notifications(session_id)
                .map(Some),
        }
    }

    pub fn store(&self) -> &SessionStore {
        &self.session_store
    }

    pub fn import_session_bundle(
        &self,
        workspace_id: &str,
        session: &SessionRecord,
        live_config_snapshot: Option<&SessionLiveConfigSnapshotRecord>,
        pending_config_changes: &[PendingConfigChangeRecord],
        pending_prompts: &[PendingPromptRecord],
        events: &[SessionEventRecord],
        raw_notifications: &[SessionRawNotificationRecord],
    ) -> anyhow::Result<()> {
        self.workspace_store
            .find_by_id(workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;
        self.session_store.import_bundle(
            session,
            live_config_snapshot,
            pending_config_changes,
            pending_prompts,
            events,
            raw_notifications,
        )
    }

    pub fn delete_session(&self, session_id: &str) -> anyhow::Result<()> {
        self.session_store.delete_session(session_id)
    }

    pub fn update_session_title(
        &self,
        session_id: &str,
        title: &str,
    ) -> Result<SessionRecord, UpdateSessionTitleError> {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return Err(UpdateSessionTitleError::EmptyTitle);
        }
        if trimmed.chars().count() > 160 {
            return Err(UpdateSessionTitleError::TitleTooLong(160));
        }

        let existing = self
            .session_store
            .find_by_id(session_id)
            .map_err(UpdateSessionTitleError::Internal)?
            .ok_or_else(|| UpdateSessionTitleError::SessionNotFound(session_id.to_string()))?;

        let now = chrono::Utc::now().to_rfc3339();
        self.session_store
            .update_title(session_id, trimmed, &now)
            .map_err(UpdateSessionTitleError::Internal)?;

        let mut updated = existing;
        updated.title = Some(trimmed.to_string());
        updated.updated_at = now;
        Ok(updated)
    }

    pub fn get_live_config_snapshot(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<anyharness_contract::v1::SessionLiveConfigSnapshot>> {
        self.session_store
            .find_live_config_snapshot(session_id)?
            .as_ref()
            .map(snapshot_from_record)
            .transpose()
    }

    pub fn get_live_config_snapshot_checked(
        &self,
        session_id: &str,
    ) -> Result<
        Option<anyharness_contract::v1::SessionLiveConfigSnapshot>,
        GetLiveConfigSnapshotError,
    > {
        if self
            .session_store
            .find_by_id(session_id)
            .map_err(GetLiveConfigSnapshotError::Internal)?
            .is_none()
        {
            return Err(GetLiveConfigSnapshotError::SessionNotFound(
                session_id.to_string(),
            ));
        }

        self.get_live_config_snapshot(session_id)
            .map_err(GetLiveConfigSnapshotError::Internal)
    }

    pub fn get_workspace_session_launch_catalog(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<WorkspaceSessionLaunchCatalogData> {
        self.workspace_store
            .find_by_id(workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;

        let registry = built_in_registry();
        let agents = model_registries()
            .into_iter()
            .filter_map(|model_registry| {
                let descriptor = registry
                    .iter()
                    .find(|d| d.kind.as_str() == model_registry.kind)?;
                let resolved = resolve_agent(descriptor, &self.runtime_home);
                if resolved.status != ResolvedAgentStatus::Ready {
                    return None;
                }

                Some(WorkspaceSessionLaunchAgentData {
                    kind: model_registry.kind.clone(),
                    display_name: model_registry.display_name.clone(),
                    default_model_id: model_registry.default_model_id.clone(),
                    models: model_registry
                        .models
                        .into_iter()
                        .map(|model| WorkspaceSessionLaunchModelData {
                            id: model.id,
                            display_name: model.display_name,
                            is_default: model.is_default,
                        })
                        .collect(),
                })
            })
            .collect();

        Ok(WorkspaceSessionLaunchCatalogData {
            workspace_id: workspace_id.to_string(),
            agents,
        })
    }
}

fn find_model_registry<'a>(
    configs: &'a [ModelRegistryMetadata],
    agent_kind: &str,
) -> anyhow::Result<&'a ModelRegistryMetadata> {
    configs
        .iter()
        .find(|config| config.kind == agent_kind)
        .ok_or_else(|| anyhow::anyhow!("model registry not found for agent '{agent_kind}'"))
}

fn resolve_model_id(
    model_registry: &ModelRegistryMetadata,
    provided_model_id: Option<&str>,
) -> anyhow::Result<Option<String>> {
    let normalized_model_id = provided_model_id.map(|model_id| {
        normalize_legacy_model_id(model_registry.kind.as_str(), model_id).unwrap_or(model_id)
    });

    let valid_model_ids = model_registry
        .models
        .iter()
        .map(|model| model.id.as_str())
        .collect::<Vec<_>>();

    resolve_catalog_id(
        normalized_model_id,
        &valid_model_ids,
        model_registry.default_model_id.as_deref(),
        "model",
    )
}

fn resolve_catalog_id(
    provided: Option<&str>,
    valid_ids: &[&str],
    default_id: Option<&str>,
    label: &str,
) -> anyhow::Result<Option<String>> {
    match provided {
        Some(id) => {
            if !valid_ids.contains(&id) {
                anyhow::bail!("invalid {label} ID: '{id}'");
            }
            Ok(Some(id.to_string()))
        }
        None => Ok(default_id.map(|value| value.to_string())),
    }
}

fn normalize_legacy_model_id(agent_kind: &str, model_id: &str) -> Option<&'static str> {
    if agent_kind != "claude" {
        return None;
    }

    match model_id {
        "claude-sonnet-4-5" | "claude-sonnet-4-6" => Some("sonnet"),
        "claude-sonnet-4-5-1m" | "claude-sonnet-4-6-1m" => Some("sonnet[1m]"),
        "claude-opus-4-5" | "claude-opus-4-6" | "claude-opus-4-6-1m" | "opus" => Some("opus[1m]"),
        "claude-haiku-4-5" => Some("haiku"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::model::ModelRegistryModelMetadata;

    fn plain_model(id: &str, is_default: bool) -> ModelRegistryModelMetadata {
        ModelRegistryModelMetadata {
            id: id.to_string(),
            display_name: id.to_string(),
            description: None,
            is_default,
        }
    }

    fn registry_with_models(models: Vec<ModelRegistryModelMetadata>) -> ModelRegistryMetadata {
        let default_model_id = models
            .iter()
            .find(|model| model.is_default)
            .map(|model| model.id.clone());

        ModelRegistryMetadata {
            kind: "test".to_string(),
            display_name: "Test".to_string(),
            default_model_id,
            models,
        }
    }

    #[test]
    fn resolves_default_model_id() {
        let provider_config = registry_with_models(vec![plain_model("default", true)]);

        let resolved =
            resolve_model_id(&provider_config, None).expect("default model should resolve");

        assert_eq!(resolved.as_deref(), Some("default"));
    }

    #[test]
    fn rejects_unknown_model_id() {
        let provider_config = registry_with_models(vec![plain_model("default", true)]);

        let error = resolve_model_id(&provider_config, Some("missing"))
            .expect_err("invalid model id should fail");

        assert!(error.to_string().contains("invalid model ID"));
    }

    #[test]
    fn normalizes_legacy_claude_opus_alias() {
        let registry = ModelRegistryMetadata {
            kind: "claude".to_string(),
            display_name: "Claude".to_string(),
            default_model_id: Some("sonnet".to_string()),
            models: vec![plain_model("sonnet", true), plain_model("opus[1m]", false)],
        };

        let resolved =
            resolve_model_id(&registry, Some("opus")).expect("legacy model id should normalize");

        assert_eq!(resolved.as_deref(), Some("opus[1m]"));
    }
}
