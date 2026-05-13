use anyharness_contract::v1::ReplayRecordingSummary;

use crate::live::sessions::actor::command::SessionCommand;
use crate::origin::OriginContext;
use crate::sessions::model::SessionRecord;
use crate::sessions::replay::{
    derive_source_agent_kind, export_recording, list_recordings, load_recording, validate_speed,
    ReplayError,
};

use super::SessionRuntime;

impl SessionRuntime {
    pub fn list_replay_recordings(&self) -> Result<Vec<ReplayRecordingSummary>, ReplayError> {
        list_recordings(&self.runtime_home)
    }

    pub fn export_replay_recording(
        &self,
        session_id: &str,
        name: Option<String>,
    ) -> Result<ReplayRecordingSummary, ReplayError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| ReplayError::Internal(anyhow::anyhow!(error.to_string())))?;
        let session = self
            .session_service
            .get_session(session_id)
            .map_err(ReplayError::Internal)?
            .ok_or_else(|| ReplayError::SessionNotFound(session_id.to_string()))?;
        let records = self
            .session_service
            .list_session_event_records(session_id, None, None, None, None)
            .map_err(ReplayError::Internal)?
            .ok_or_else(|| ReplayError::SessionNotFound(session_id.to_string()))?;

        export_recording(&self.runtime_home, &session, records, name)
    }

    pub async fn create_and_start_replay_session(
        &self,
        workspace_id: &str,
        recording_id: &str,
        speed: Option<f32>,
    ) -> Result<SessionRecord, ReplayError> {
        self.access_gate
            .assert_can_mutate_for_workspace(workspace_id)
            .map_err(|error| ReplayError::Internal(anyhow::anyhow!(error.to_string())))?;
        let speed = validate_speed(speed)?;
        let events = load_recording(&self.runtime_home, recording_id)?;
        let source_agent_kind = derive_source_agent_kind(&events).ok_or_else(|| {
            ReplayError::InvalidJson("recording has no source agent kind".to_string())
        })?;
        let workspace = self
            .workspace_runtime
            .get_workspace(workspace_id)
            .map_err(ReplayError::Internal)?
            .ok_or_else(|| ReplayError::WorkspaceNotFound(workspace_id.to_string()))?;
        if workspace.surface == "cowork"
            && self
                .session_service
                .list_sessions(Some(workspace_id), true)
                .map_err(ReplayError::Internal)?
                .into_iter()
                .next()
                .is_some()
        {
            return Err(ReplayError::Internal(anyhow::anyhow!(
                "cowork workspaces support only one session"
            )));
        }

        let now = chrono::Utc::now().to_rfc3339();
        let mut record = SessionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: source_agent_kind,
            native_session_id: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: Some(format!("Replay: {recording_id}")),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "starting".into(),
            created_at: now.clone(),
            updated_at: now,
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: Some(OriginContext::system_local_runtime()),
        };
        self.session_service
            .store()
            .insert(&record)
            .map_err(ReplayError::Internal)?;

        let session_store = self.session_service.store().clone();
        let (_handle, ready) = self
            .acp_manager
            .start_replay_session(record.clone(), events, speed, session_store, 0)
            .await
            .map_err(ReplayError::Internal)?;
        self.persist_live_session_state(&record.id, &ready.native_session_id);
        record.native_session_id = Some(ready.native_session_id);
        record.status = "idle".to_string();
        Ok(record)
    }

    pub async fn advance_replay_session(&self, session_id: &str) -> Result<(), ReplayError> {
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| ReplayError::Internal(anyhow::anyhow!(error.to_string())))?;
        let handle = self
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or_else(|| ReplayError::SessionNotLive(session_id.to_string()))?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        handle
            .command_tx
            .send(SessionCommand::ReplayAdvance { respond_to: tx })
            .await
            .map_err(|_| ReplayError::SessionNotLive(session_id.to_string()))?;
        rx.await
            .map_err(|_| ReplayError::SessionNotLive(session_id.to_string()))?
            .map_err(ReplayError::Internal)
    }
}
