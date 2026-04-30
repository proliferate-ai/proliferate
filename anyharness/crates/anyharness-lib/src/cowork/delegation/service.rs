use std::sync::Arc;

use uuid::Uuid;

use super::model::{
    CodingWorkspaceLaunchOption, MAX_CODING_SESSIONS_PER_MANAGED_WORKSPACE,
    MAX_MANAGED_WORKSPACES_PER_COWORK_SESSION,
};
use crate::cowork::model::{CoworkManagedWorkspaceRecord, CoworkThreadRecord};
use crate::cowork::service::CoworkService;
use crate::sessions::delegation::{self, DelegatedEventSlice};
use crate::sessions::links::completions::{
    LinkCompletionRecord, LinkCompletionStore, LinkWakeScheduleRecord,
};
use crate::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::sessions::links::service::SessionLinkService;
use crate::sessions::model::SessionRecord;
use crate::sessions::prompt::PromptProvenance;
use crate::sessions::store::SessionStore;
use crate::workspaces::access_gate::WorkspaceAccessGate;
use crate::workspaces::model::WorkspaceRecord;
use crate::workspaces::runtime::WorkspaceRuntime;

#[derive(Debug, thiserror::Error)]
pub enum CoworkDelegationError {
    #[error("cowork thread not found for session: {0}")]
    CoworkThreadNotFound(String),
    #[error("cowork workspace delegation is disabled for this thread")]
    Disabled,
    #[error("source workspace not found: {0}")]
    SourceWorkspaceNotFound(String),
    #[error("managed workspace not found: {0}")]
    ManagedWorkspaceNotFound(String),
    #[error("coding session not found: {0}")]
    CodingSessionNotFound(String),
    #[error("workspace is not eligible as a coding workspace source: {0}")]
    IneligibleSourceWorkspace(String),
    #[error("workspace is not owned by this cowork session")]
    WorkspaceNotOwned,
    #[error("coding session is not owned by this cowork session")]
    CodingSessionNotOwned,
    #[error("workspace mutation blocked: {0}")]
    MutationBlocked(String),
    #[error("cowork session already has the maximum number of managed coding workspaces")]
    WorkspaceLimit,
    #[error("managed workspace already has the maximum number of coding sessions")]
    SessionLimit,
    #[error("session link already exists")]
    DuplicateLink,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Clone)]
pub struct CoworkDelegationService {
    cowork_service: CoworkService,
    session_store: SessionStore,
    link_service: SessionLinkService,
    completion_store: LinkCompletionStore,
    workspace_runtime: Arc<WorkspaceRuntime>,
    access_gate: Arc<WorkspaceAccessGate>,
}

impl CoworkDelegationService {
    pub fn new(
        cowork_service: CoworkService,
        session_store: SessionStore,
        link_service: SessionLinkService,
        completion_store: LinkCompletionStore,
        workspace_runtime: Arc<WorkspaceRuntime>,
        access_gate: Arc<WorkspaceAccessGate>,
    ) -> Self {
        Self {
            cowork_service,
            session_store,
            link_service,
            completion_store,
            workspace_runtime,
            access_gate,
        }
    }

    pub fn validate_parent_thread(
        &self,
        parent_session_id: &str,
    ) -> Result<CoworkThreadRecord, CoworkDelegationError> {
        self.cowork_service
            .find_thread_by_session(parent_session_id)?
            .ok_or_else(|| CoworkDelegationError::CoworkThreadNotFound(parent_session_id.into()))
    }

    pub fn validate_parent_can_delegate(
        &self,
        parent_session_id: &str,
    ) -> Result<CoworkThreadRecord, CoworkDelegationError> {
        let thread = self.validate_parent_thread(parent_session_id)?;
        if !thread.workspace_delegation_enabled {
            return Err(CoworkDelegationError::Disabled);
        }
        Ok(thread)
    }

    pub fn workspace_delegation_enabled(&self, parent_session_id: &str) -> anyhow::Result<bool> {
        Ok(self
            .cowork_service
            .find_thread_by_session(parent_session_id)?
            .is_some_and(|thread| thread.workspace_delegation_enabled))
    }

    pub fn list_source_workspace_options(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<CodingWorkspaceLaunchOption>, CoworkDelegationError> {
        self.validate_parent_can_delegate(parent_session_id)?;
        Ok(self
            .workspace_runtime
            .list_workspaces()?
            .into_iter()
            .filter_map(|workspace| {
                let reason = self.source_workspace_block_reason(&workspace);
                if reason.is_some() {
                    return None;
                }
                Some(CodingWorkspaceLaunchOption {
                    workspace,
                    create_block_reason: None,
                })
            })
            .collect())
    }

    pub fn validate_source_workspace(
        &self,
        source_workspace_id: &str,
    ) -> Result<WorkspaceRecord, CoworkDelegationError> {
        let workspace = self
            .workspace_runtime
            .get_workspace(source_workspace_id)?
            .ok_or_else(|| {
                CoworkDelegationError::SourceWorkspaceNotFound(source_workspace_id.into())
            })?;
        if let Some(reason) = self.source_workspace_block_reason(&workspace) {
            return Err(CoworkDelegationError::IneligibleSourceWorkspace(reason));
        }
        Ok(workspace)
    }

    pub fn insert_managed_workspace(
        &self,
        record: &CoworkManagedWorkspaceRecord,
    ) -> Result<(), CoworkDelegationError> {
        let inserted = self
            .cowork_service
            .insert_managed_workspace_with_limit(record, MAX_MANAGED_WORKSPACES_PER_COWORK_SESSION)
            .map_err(map_unique_error)?;
        if inserted {
            Ok(())
        } else {
            Err(CoworkDelegationError::WorkspaceLimit)
        }
    }

    pub fn delete_managed_workspace(&self, id: &str) -> anyhow::Result<()> {
        self.cowork_service.delete_managed_workspace(id)
    }

    pub fn find_managed_workspace(
        &self,
        parent_session_id: &str,
        workspace_id: &str,
    ) -> Result<CoworkManagedWorkspaceRecord, CoworkDelegationError> {
        self.cowork_service
            .find_managed_workspace(parent_session_id, workspace_id)?
            .ok_or(CoworkDelegationError::WorkspaceNotOwned)
    }

    pub fn list_managed_workspaces(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<CoworkManagedWorkspaceRecord>, CoworkDelegationError> {
        self.validate_parent_thread(parent_session_id)?;
        Ok(self
            .cowork_service
            .list_managed_workspaces(parent_session_id)?)
    }

    pub fn create_coding_session_link(
        &self,
        parent_session_id: &str,
        workspace_id: &str,
        child_session_id: &str,
        label: Option<String>,
    ) -> Result<SessionLinkRecord, CoworkDelegationError> {
        self.find_managed_workspace(parent_session_id, workspace_id)?;
        let child = self
            .session_store
            .find_by_id(child_session_id)?
            .ok_or_else(|| CoworkDelegationError::CodingSessionNotFound(child_session_id.into()))?;
        if child.workspace_id != workspace_id {
            return Err(CoworkDelegationError::WorkspaceNotOwned);
        }
        let record = SessionLinkRecord {
            id: Uuid::new_v4().to_string(),
            relation: SessionLinkRelation::CoworkCodingSession,
            parent_session_id: parent_session_id.to_string(),
            child_session_id: child_session_id.to_string(),
            workspace_relation: SessionLinkWorkspaceRelation::CoworkManagedWorkspace,
            label,
            created_by_turn_id: None,
            created_by_tool_call_id: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let inserted = self
            .cowork_service
            .insert_coding_session_link_with_workspace_limit(
                &record,
                workspace_id,
                MAX_CODING_SESSIONS_PER_MANAGED_WORKSPACE,
            )
            .map_err(map_unique_error)?;
        if inserted {
            Ok(record)
        } else {
            Err(CoworkDelegationError::SessionLimit)
        }
    }

    pub fn authorize_coding_session(
        &self,
        parent_session_id: &str,
        coding_session_id: &str,
    ) -> Result<SessionLinkRecord, CoworkDelegationError> {
        delegation::authorize_child(
            &self.link_service,
            SessionLinkRelation::CoworkCodingSession,
            parent_session_id,
            coding_session_id,
        )
        .map_err(|_| CoworkDelegationError::CodingSessionNotOwned)
    }

    pub fn find_coding_parent_for_child(
        &self,
        coding_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.link_service
            .find_parent_by_relation(SessionLinkRelation::CoworkCodingSession, coding_session_id)
    }

    pub fn schedule_coding_wake(
        &self,
        parent_session_id: &str,
        coding_session_id: &str,
    ) -> Result<(SessionLinkRecord, bool), CoworkDelegationError> {
        let link = self.authorize_coding_session(parent_session_id, coding_session_id)?;
        let inserted = self.completion_store.schedule_wake(&link.id)?;
        Ok((link, inserted))
    }

    pub fn delete_wake_schedule(&self, session_link_id: &str) -> anyhow::Result<bool> {
        self.completion_store.delete_wake_schedule(session_link_id)
    }

    pub fn insert_completion_and_consume_schedule(
        &self,
        record: &LinkCompletionRecord,
        parent_session_id: &str,
        wake_prompt: &crate::sessions::prompt::PromptPayload,
    ) -> anyhow::Result<Option<crate::sessions::links::completions::LinkCompletionInsert>> {
        self.completion_store
            .insert_completion_and_consume_schedule(record, parent_session_id, wake_prompt)
    }

    pub fn mark_parent_event_seq(&self, completion_id: &str, seq: i64) -> anyhow::Result<()> {
        self.completion_store
            .mark_parent_event_seq(completion_id, seq)
    }

    pub fn latest_completion_for_link(
        &self,
        session_link_id: &str,
    ) -> anyhow::Result<Option<LinkCompletionRecord>> {
        self.completion_store
            .latest_completion_for_link(session_link_id)
    }

    pub fn list_wake_schedules(
        &self,
        link_ids: &[String],
    ) -> anyhow::Result<Vec<LinkWakeScheduleRecord>> {
        self.completion_store.list_wake_schedules(link_ids)
    }

    pub fn list_coding_session_links(
        &self,
        parent_session_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<(SessionLinkRecord, SessionRecord)>, CoworkDelegationError> {
        let mut links = Vec::new();
        for link in self.link_service.list_children_by_relation(
            SessionLinkRelation::CoworkCodingSession,
            parent_session_id,
        )? {
            let Some(child) = self.session_store.find_by_id(&link.child_session_id)? else {
                continue;
            };
            if child.workspace_id == workspace_id {
                links.push((link, child));
            }
        }
        Ok(links)
    }

    pub fn read_coding_events(
        &self,
        parent_session_id: &str,
        coding_session_id: &str,
        since_seq: Option<i64>,
        limit: Option<usize>,
    ) -> Result<DelegatedEventSlice, CoworkDelegationError> {
        Ok(delegation::read_child_events(
            &self.session_store,
            &self.link_service,
            SessionLinkRelation::CoworkCodingSession,
            parent_session_id,
            coding_session_id,
            since_seq,
            limit,
        )?)
    }

    pub(crate) fn parent_to_child_provenance(
        parent_session_id: &str,
        session_link_id: &str,
        label: Option<String>,
    ) -> PromptProvenance {
        delegation::parent_to_child_provenance(parent_session_id, session_link_id, label)
    }

    pub fn session_store(&self) -> &SessionStore {
        &self.session_store
    }

    fn source_workspace_block_reason(&self, workspace: &WorkspaceRecord) -> Option<String> {
        if workspace.surface != "standard" {
            return Some("workspace is not a standard coding workspace".to_string());
        }
        if !matches!(workspace.kind.as_str(), "local" | "worktree") {
            return Some("workspace is not local/worktree-backed".to_string());
        }
        if workspace.repo_root_id.is_none() {
            return Some("workspace has no repo root metadata".to_string());
        }
        if self
            .cowork_service
            .find_managed_workspace_by_workspace(&workspace.id)
            .ok()
            .flatten()
            .is_some()
        {
            return Some("workspace is already managed by cowork".to_string());
        }
        if let Err(error) = self
            .access_gate
            .assert_can_mutate_for_workspace(&workspace.id)
        {
            return Some(error.to_string());
        }
        None
    }
}

fn map_unique_error(error: anyhow::Error) -> CoworkDelegationError {
    if is_unique_constraint_error(&error) {
        CoworkDelegationError::DuplicateLink
    } else {
        CoworkDelegationError::Internal(error)
    }
}

fn is_unique_constraint_error(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<rusqlite::Error>()
        .and_then(|inner| match inner {
            rusqlite::Error::SqliteFailure(code, _) => Some(code.extended_code),
            _ => None,
        })
        .is_some_and(|code| code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE)
}
