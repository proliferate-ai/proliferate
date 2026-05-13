use std::time::Instant;

use uuid::Uuid;

use super::attachment_storage::PromptAttachmentStorage;
use super::live_config::snapshot_from_record;
use super::model::{
    PendingConfigChangeRecord, PendingPromptRecord, SessionEventRecord,
    SessionLiveConfigSnapshotRecord, SessionMcpBindingPolicy, SessionRawNotificationRecord,
    SessionRecord,
};
use super::store::SessionStore;
use crate::domains::agents::catalog::projection::models::{
    bundled_create_mode_ids, bundled_model_registries,
};
use crate::domains::agents::model::{ModelRegistryMetadata, ResolvedAgentStatus};
use crate::domains::agents::readiness::launch_options::{
    workspace_session_launch_options, ResolvedWorkspaceLaunchOptions,
};
use crate::domains::agents::readiness::resolver::resolve_agent;
use crate::domains::agents::registry::built_in_registry;
use crate::domains::mobility::model::MobilityPromptAttachmentData;
use crate::origin::OriginContext;
use crate::workspaces::store::WorkspaceStore;
pub struct SessionService {
    session_store: SessionStore,
    attachment_storage: PromptAttachmentStorage,
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
    ModelUnsupported {
        agent_kind: String,
        model_id: String,
    },
    ModeUnsupported {
        agent_kind: String,
        mode_id: String,
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

impl SessionService {
    pub fn new(
        session_store: SessionStore,
        workspace_store: WorkspaceStore,
        runtime_home: std::path::PathBuf,
    ) -> Self {
        Self {
            session_store,
            attachment_storage: PromptAttachmentStorage::new(runtime_home.clone()),
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
        if resolved.status != ResolvedAgentStatus::Ready {
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
        let registries = bundled_model_registries();
        let model_registry = find_model_registry(&registries, agent_kind)
            .map_err(|error| CreateSessionError::Invalid(error.to_string()))?;
        let resolved_model_id =
            resolve_model_id(model_registry, model_id).map_err(|error| match error {
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
        before_seq: Option<i64>,
        limit: Option<i64>,
        turn_limit: Option<i64>,
    ) -> anyhow::Result<Option<Vec<SessionEventRecord>>> {
        if self.session_store.find_by_id(session_id)?.is_none() {
            return Ok(None);
        }

        match (after_seq, before_seq, limit, turn_limit) {
            (Some(_), Some(_), _, _) | (Some(_), _, _, Some(_)) => {
                anyhow::bail!("after_seq cannot be combined with before_seq or turn_limit")
            }
            (Some(seq), None, Some(limit), None) => self
                .session_store
                .list_events_after_limited(session_id, seq, limit)
                .map(Some),
            (Some(seq), None, None, None) => self
                .session_store
                .list_events_after(session_id, seq)
                .map(Some),
            (None, Some(seq), Some(limit), Some(turn_limit)) => self
                .session_store
                .list_events_before_for_latest_turns(session_id, seq, turn_limit, limit)
                .map(Some),
            (None, Some(seq), Some(limit), None) => self
                .session_store
                .list_events_before_limited(session_id, seq, limit)
                .map(Some),
            (None, Some(seq), None, Some(turn_limit)) => self
                .session_store
                .list_events_before_for_latest_turns(session_id, seq, turn_limit, 5_000)
                .map(Some),
            (None, Some(seq), None, None) => self
                .session_store
                .list_events_before_limited(session_id, seq, 5_000)
                .map(Some),
            (None, None, Some(limit), Some(turn_limit)) => self
                .session_store
                .list_events_for_latest_turns(session_id, turn_limit, limit)
                .map(Some),
            (None, None, None, Some(turn_limit)) => self
                .session_store
                .list_events_for_latest_turns(session_id, turn_limit, 5_000)
                .map(Some),
            (None, None, Some(limit), None) => self
                .session_store
                .list_events_limited(session_id, limit)
                .map(Some),
            (None, None, None, None) => self.session_store.list_events(session_id).map(Some),
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

    pub fn attachment_storage(&self) -> &PromptAttachmentStorage {
        &self.attachment_storage
    }

    pub fn read_prompt_attachment_content(
        &self,
        record: &super::model::PromptAttachmentRecord,
    ) -> anyhow::Result<Vec<u8>> {
        read_prompt_attachment_content_with_legacy_fallback(
            &self.session_store,
            &self.attachment_storage,
            record,
        )
    }

    pub fn import_session_bundle(
        &self,
        workspace_id: &str,
        session: &SessionRecord,
        live_config_snapshot: Option<&SessionLiveConfigSnapshotRecord>,
        pending_config_changes: &[PendingConfigChangeRecord],
        pending_prompts: &[PendingPromptRecord],
        prompt_attachments: &[MobilityPromptAttachmentData],
        events: &[SessionEventRecord],
        raw_notifications: &[SessionRawNotificationRecord],
    ) -> anyhow::Result<()> {
        self.workspace_store
            .find_by_id(workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;
        let mut records = Vec::with_capacity(prompt_attachments.len());
        for attachment in prompt_attachments {
            if let Err(error) = self.attachment_storage.write_new(
                &attachment.record.session_id,
                &attachment.record.attachment_id,
                &attachment.content,
            ) {
                for record in &records {
                    let _ = self.attachment_storage.delete_record(record);
                }
                return Err(error);
            }
            records.push(attachment.record.clone());
        }
        let result = self.session_store.import_bundle(
            session,
            live_config_snapshot,
            pending_config_changes,
            pending_prompts,
            &records,
            events,
            raw_notifications,
        );
        if result.is_err() {
            for record in &records {
                let _ = self.attachment_storage.delete_record(record);
            }
        }
        result
    }

    pub fn delete_session(&self, session_id: &str) -> anyhow::Result<()> {
        self.session_store.delete_session(session_id)?;
        if let Err(error) = self.attachment_storage.delete_session_dir(session_id) {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to delete session prompt attachment directory"
            );
        }
        Ok(())
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

    pub fn resolved_workspace_launch_options(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> {
        self.workspace_store
            .find_by_id(workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;

        Ok(workspace_session_launch_options(&self.runtime_home))
    }
}

pub fn read_prompt_attachment_content_with_legacy_fallback(
    store: &SessionStore,
    attachment_storage: &PromptAttachmentStorage,
    record: &super::model::PromptAttachmentRecord,
) -> anyhow::Result<Vec<u8>> {
    let has_storage_path = !record.storage_path.trim().is_empty();
    if has_storage_path {
        match attachment_storage.read(record) {
            Ok(content) => return Ok(content),
            Err(error) => {
                tracing::warn!(
                    session_id = %record.session_id,
                    attachment_id = %record.attachment_id,
                    error = %error,
                    "failed to read file-backed prompt attachment; trying legacy content"
                );
            }
        }
    }

    let content = store
        .read_legacy_prompt_attachment_content(&record.session_id, &record.attachment_id)?
        .ok_or_else(|| anyhow::anyhow!("prompt attachment bytes missing"))?;
    if content.is_empty()
        && has_storage_path
        && !(record.size_bytes == 0 && record.sha256 == EMPTY_SHA256)
    {
        anyhow::bail!("prompt attachment file is missing and legacy placeholder is empty");
    }
    let storage_path =
        attachment_storage.write_new(&record.session_id, &record.attachment_id, &content)?;
    store.update_prompt_attachment_storage_path(
        &record.session_id,
        &record.attachment_id,
        &storage_path,
    )?;
    Ok(content)
}

const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

fn find_model_registry<'a>(
    configs: &'a [ModelRegistryMetadata],
    agent_kind: &str,
) -> anyhow::Result<&'a ModelRegistryMetadata> {
    configs
        .iter()
        .find(|config| config.kind == agent_kind)
        .ok_or_else(|| anyhow::anyhow!("model registry not found for agent '{agent_kind}'"))
}

#[derive(Debug)]
enum ModelResolutionError {
    Unsupported(String),
    Invalid(String),
}

fn resolve_model_id(
    model_registry: &ModelRegistryMetadata,
    provided_model_id: Option<&str>,
) -> Result<Option<String>, ModelResolutionError> {
    let valid_ids = model_registry
        .models
        .iter()
        .map(|model| model.id.as_str())
        .collect::<Vec<_>>();
    let resolved_model_id = provided_model_id
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
        .map(|model_id| {
            if valid_ids.contains(&model_id) {
                return model_id;
            }
            let normalized_model_id =
                normalize_legacy_model_id(model_registry.kind.as_str(), model_id)
                    .unwrap_or(model_id);
            resolve_model_alias(model_registry, normalized_model_id).unwrap_or(normalized_model_id)
        });

    resolve_catalog_id(
        resolved_model_id,
        &valid_ids,
        model_registry.default_model_id.as_deref(),
        "model",
    )
    .map_err(|error| match (provided_model_id, error) {
        (Some(model_id), CatalogIdResolutionError::Invalid(_)) => {
            ModelResolutionError::Unsupported(model_id.trim().to_string())
        }
        (_, CatalogIdResolutionError::Invalid(detail)) => ModelResolutionError::Invalid(detail),
    })
}

fn resolve_model_alias<'a>(
    model_registry: &'a ModelRegistryMetadata,
    provided_model_id: &str,
) -> Option<&'a str> {
    model_registry
        .models
        .iter()
        .find(|model| model.aliases.iter().any(|alias| alias == provided_model_id))
        .map(|model| model.id.as_str())
}

fn resolve_catalog_id(
    provided: Option<&str>,
    valid_ids: &[&str],
    default_id: Option<&str>,
    label: &str,
) -> Result<Option<String>, CatalogIdResolutionError> {
    match provided {
        Some(id) => {
            if !valid_ids.contains(&id) {
                return Err(CatalogIdResolutionError::Invalid(format!(
                    "invalid {label} ID: '{id}'"
                )));
            }
            Ok(Some(id.to_string()))
        }
        None => Ok(default_id.map(|value| value.to_string())),
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

#[derive(Debug)]
enum CatalogIdResolutionError {
    Invalid(String),
}

fn normalize_legacy_model_id(agent_kind: &str, model_id: &str) -> Option<&'static str> {
    if agent_kind != "claude" {
        return None;
    }

    match model_id {
        "claude-sonnet-4-5" | "claude-sonnet-4-6" => Some("sonnet"),
        "claude-sonnet-4-5-1m" | "claude-sonnet-4-6-1m" => Some("sonnet[1m]"),
        "claude-opus-4-5" | "claude-opus-4-6-1m" | "opus" => Some("opus[1m]"),
        "claude-haiku-4-5" => Some("haiku"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::model::{
        ModelCatalogStatus, ModelRegistryModelMetadata, SessionDefaultControlsState,
    };

    fn plain_model(id: &str, is_default: bool) -> ModelRegistryModelMetadata {
        ModelRegistryModelMetadata {
            id: id.to_string(),
            display_name: id.to_string(),
            description: None,
            is_default,
            status: ModelCatalogStatus::Active,
            aliases: vec![],
            min_runtime_version: None,
            launch_remediation: None,
            session_default_controls: vec![],
            session_default_controls_state: SessionDefaultControlsState::Empty,
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

        assert!(matches!(
            error,
            ModelResolutionError::Unsupported(model_id) if model_id == "missing"
        ));
    }

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

    #[test]
    fn resolves_catalog_aliases_to_canonical_model_id() {
        let mut opus = plain_model("opus[1m]", false);
        opus.aliases = vec!["claude-opus-4-7".to_string()];
        let registry = ModelRegistryMetadata {
            kind: "claude".to_string(),
            display_name: "Claude".to_string(),
            default_model_id: Some("sonnet".to_string()),
            models: vec![plain_model("sonnet", true), opus],
        };

        let resolved = resolve_model_id(&registry, Some("claude-opus-4-7"))
            .expect("catalog alias should resolve");

        assert_eq!(resolved.as_deref(), Some("opus[1m]"));
    }

    #[test]
    fn preserves_pinned_claude_opus_4_6_model_id() {
        let registry = ModelRegistryMetadata {
            kind: "claude".to_string(),
            display_name: "Claude".to_string(),
            default_model_id: Some("sonnet".to_string()),
            models: {
                let mut opus = plain_model("opus[1m]", false);
                opus.aliases = vec!["claude-opus-4-6".to_string()];
                vec![
                    plain_model("sonnet", true),
                    opus,
                    plain_model("claude-opus-4-6", false),
                ]
            },
        };

        let resolved = resolve_model_id(&registry, Some("claude-opus-4-6"))
            .expect("pinned Opus 4.6 model id should resolve directly");

        assert_eq!(resolved.as_deref(), Some("claude-opus-4-6"));
    }
}
