//! Read-side assembly of one session: the durable record joined with its
//! live-config snapshot, live execution snapshot, and pending prompts.
//! [`SessionView`] is the domain-side aggregate; HTTP maps it to the wire
//! `Session` via the dep-less [`SessionView::into_contract`] (see
//! `api/http/sessions_contract.rs`). List endpoints assemble the whole page
//! with batched queries via [`SessionRuntime::session_views`].

use std::collections::HashMap;

use anyharness_contract::v1::{
    Session, SessionExecutionSummary, SessionLinkSummary, SessionLiveConfigSnapshot,
    WorkspaceExecutionSummary,
};

use crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions;
use crate::domains::sessions::execution_summary::{
    idle_workspace_execution_summary, summarize_session_record, summarize_workspace_sessions,
};
use crate::domains::sessions::links::model::SessionLinkRecord;
use crate::domains::sessions::model::{PendingPromptRecord, SessionRecord};

use super::SessionRuntime;

/// Everything one read of a session needs, fetched once.
pub struct SessionView {
    pub record: SessionRecord,
    pub live_config: Option<SessionLiveConfigSnapshot>,
    pub execution_summary: SessionExecutionSummary,
    pub pending_prompts: Vec<PendingPromptRecord>,
}

impl SessionView {
    /// Pure mapper to the wire `Session` — no IO, no AppState.
    pub fn into_contract(self) -> Session {
        let mut session = self
            .record
            .to_contract_with_details(self.live_config, Some(self.execution_summary));
        session.pending_prompts = self
            .pending_prompts
            .iter()
            .map(PendingPromptRecord::to_contract)
            .collect();
        session
    }
}

impl SessionRuntime {
    pub async fn session_view(&self, record: &SessionRecord) -> anyhow::Result<SessionView> {
        let live_config = self.session_service.get_live_config_snapshot(&record.id)?;
        self.session_view_with_live_config(record, live_config)
            .await
    }

    pub async fn session_view_with_live_config(
        &self,
        record: &SessionRecord,
        live_config: Option<SessionLiveConfigSnapshot>,
    ) -> anyhow::Result<SessionView> {
        let execution_summary = self.session_execution_summary(record).await;
        let pending_prompts = self
            .session_service
            .store()
            .list_pending_prompts(&record.id)?;
        Ok(SessionView {
            record: record.clone(),
            live_config,
            execution_summary,
            pending_prompts,
        })
    }

    /// Assembles the views for a whole page of sessions with batched queries:
    /// one live-config query and one pending-prompts query for the page
    /// (live handles are in-memory lookups), instead of two queries per
    /// session. Output order matches `records`.
    pub async fn session_views(
        &self,
        records: &[SessionRecord],
    ) -> anyhow::Result<Vec<SessionView>> {
        let session_ids: Vec<String> = records.iter().map(|record| record.id.clone()).collect();
        let mut live_configs = self.session_service.get_live_config_snapshots(&session_ids)?;
        let mut pending_prompts = self
            .session_service
            .store()
            .list_pending_prompts_for_sessions(&session_ids)?;

        let mut views = Vec::with_capacity(records.len());
        for record in records {
            views.push(SessionView {
                record: record.clone(),
                live_config: live_configs.remove(&record.id),
                execution_summary: self.session_execution_summary(record).await,
                pending_prompts: pending_prompts.remove(&record.id).unwrap_or_default(),
            });
        }
        Ok(views)
    }

    pub async fn session_execution_summary(
        &self,
        record: &SessionRecord,
    ) -> SessionExecutionSummary {
        let live_snapshot = match self.acp_manager.get_handle(&record.id).await {
            Some(handle) => Some(handle.execution_snapshot().await),
            None => None,
        };

        summarize_session_record(record, live_snapshot.as_ref())
    }

    pub async fn workspace_execution_summary(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<WorkspaceExecutionSummary> {
        let records = self
            .session_service
            .list_sessions(Some(workspace_id), false)?;
        Ok(self
            .summarize_workspace_session_records(records)
            .await
            .unwrap_or_else(idle_workspace_execution_summary))
    }

    pub async fn workspace_execution_summaries(
        &self,
    ) -> anyhow::Result<HashMap<String, WorkspaceExecutionSummary>> {
        let records = self.session_service.list_sessions(None, false)?;
        let mut grouped = HashMap::<String, Vec<SessionRecord>>::new();

        for record in records {
            grouped
                .entry(record.workspace_id.clone())
                .or_default()
                .push(record);
        }

        let mut summaries = HashMap::with_capacity(grouped.len());
        for (workspace_id, records) in grouped {
            let summary = self
                .summarize_workspace_session_records(records)
                .await
                .unwrap_or_else(idle_workspace_execution_summary);
            summaries.insert(workspace_id, summary);
        }

        Ok(summaries)
    }

    pub fn resolved_workspace_launch_options(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> {
        self.session_service
            .resolved_workspace_launch_options(Some(workspace_id))
    }

    pub fn live_config_snapshot(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<SessionLiveConfigSnapshot>> {
        self.session_service.get_live_config_snapshot(session_id)
    }

    async fn summarize_workspace_session_records(
        &self,
        records: Vec<SessionRecord>,
    ) -> Option<WorkspaceExecutionSummary> {
        if records.is_empty() {
            return None;
        }

        let mut summaries = Vec::with_capacity(records.len());
        for record in &records {
            summaries.push(self.session_execution_summary(record).await);
        }

        Some(summarize_workspace_sessions(summaries.iter()))
    }
}

#[cfg(test)]
mod tests {
    use anyharness_contract::v1::{
        NormalizedSessionControls, PromptCapabilities, SessionExecutionPhase,
    };

    use super::*;
    use crate::domains::sessions::runtime::tests::session_record;

    /// Equality proof for the contract.rs → view.rs move: for the same
    /// inputs, the legacy builder (the exact body of the deleted
    /// `session_to_contract_with_live_config`) and `SessionView::into_contract`
    /// must serialize to byte-identical wire JSON.
    #[test]
    fn into_contract_matches_legacy_session_assembly_byte_for_byte() {
        let record = session_record("claude");
        let live_config = Some(SessionLiveConfigSnapshot {
            raw_config_options: Vec::new(),
            normalized_controls: NormalizedSessionControls::default(),
            prompt_capabilities: PromptCapabilities::default(),
            source_seq: 7,
            updated_at: "2026-04-11T00:00:05Z".to_string(),
        });
        let execution_summary = SessionExecutionSummary {
            phase: SessionExecutionPhase::Idle,
            has_live_handle: false,
            pending_interactions: Vec::new(),
            updated_at: record.updated_at.clone(),
        };
        let pending_prompts = vec![PendingPromptRecord {
            session_id: record.id.clone(),
            seq: 1,
            prompt_id: Some("prompt-1".to_string()),
            text: "queued prompt".to_string(),
            blocks_json: None,
            provenance_json: None,
            queued_at: "2026-04-11T00:00:06Z".to_string(),
        }];

        for live_config in [None, live_config] {
            // Legacy assembly: the deleted runtime/contract.rs body.
            let mut legacy = record
                .to_contract_with_details(live_config.clone(), Some(execution_summary.clone()));
            legacy.pending_prompts = pending_prompts
                .iter()
                .map(PendingPromptRecord::to_contract)
                .collect();

            let view = SessionView {
                record: record.clone(),
                live_config,
                execution_summary: execution_summary.clone(),
                pending_prompts: pending_prompts.clone(),
            };

            assert_eq!(
                serde_json::to_string(&legacy).expect("serialize legacy"),
                serde_json::to_string(&view.into_contract()).expect("serialize view"),
            );
        }
    }
}

pub(crate) fn session_link_to_summary(record: &SessionLinkRecord) -> SessionLinkSummary {
    SessionLinkSummary {
        id: record.id.clone(),
        public_id: record.public_id.clone(),
        relation: record.relation.as_str().to_string(),
        parent_session_id: record.parent_session_id.clone(),
        child_session_id: record.child_session_id.clone(),
        workspace_relation: record.workspace_relation.as_str().to_string(),
        label: record.label.clone(),
        created_at: record.created_at.clone(),
        closed_at: record.closed_at.clone(),
    }
}
