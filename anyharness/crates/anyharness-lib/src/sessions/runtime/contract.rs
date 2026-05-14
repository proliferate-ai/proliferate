use std::collections::HashMap;

use anyharness_contract::v1::{
    Session, SessionExecutionSummary, SessionLinkSummary, SessionLiveConfigSnapshot,
    WorkspaceExecutionSummary,
};

use crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions;
use crate::sessions::execution_summary::{
    idle_workspace_execution_summary, summarize_session_record, summarize_workspace_sessions,
};
use crate::sessions::links::model::SessionLinkRecord;
use crate::sessions::model::SessionRecord;

use super::SessionRuntime;

impl SessionRuntime {
    pub async fn session_to_contract(&self, record: &SessionRecord) -> anyhow::Result<Session> {
        let live_config = self.session_service.get_live_config_snapshot(&record.id)?;
        self.session_to_contract_with_live_config(record, live_config)
            .await
    }

    pub async fn session_to_contract_with_live_config(
        &self,
        record: &SessionRecord,
        live_config: Option<SessionLiveConfigSnapshot>,
    ) -> anyhow::Result<Session> {
        let execution_summary = self.session_execution_summary(record).await;
        let mut session = record.to_contract_with_details(live_config, Some(execution_summary));
        session.pending_prompts = self
            .session_service
            .store()
            .list_pending_prompts(&record.id)?
            .into_iter()
            .map(|record| record.to_contract())
            .collect();
        Ok(session)
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
            .resolved_workspace_launch_options(workspace_id)
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
