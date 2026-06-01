use uuid::Uuid;

use super::model::{SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation};
use super::store::{InsertSubagentLinkOutcome, SessionLinkStore};
use crate::domains::sessions::store::SessionStore;

#[derive(Debug, Clone)]
pub struct CreateSessionLinkInput {
    pub relation: SessionLinkRelation,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub workspace_relation: SessionLinkWorkspaceRelation,
    pub label: Option<String>,
    pub created_by_turn_id: Option<String>,
    pub created_by_tool_call_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum CreateSessionLinkError {
    #[error("parent session not found: {0}")]
    ParentNotFound(String),
    #[error("child session not found: {0}")]
    ChildNotFound(String),
    #[error("session cannot be linked to itself")]
    SelfLink,
    #[error("session link already exists")]
    Duplicate,
    #[error("child session already has a subagent parent")]
    ChildAlreadyLinked,
    #[error("parent already has the maximum number of subagents")]
    FanoutLimit,
    #[error(transparent)]
    Store(anyhow::Error),
}

#[derive(Clone)]
pub struct SessionLinkService {
    store: SessionLinkStore,
    session_store: SessionStore,
}

impl SessionLinkService {
    pub fn new(store: SessionLinkStore, session_store: SessionStore) -> Self {
        Self {
            store,
            session_store,
        }
    }

    pub fn create_link(
        &self,
        input: CreateSessionLinkInput,
    ) -> Result<SessionLinkRecord, CreateSessionLinkError> {
        if input.parent_session_id == input.child_session_id {
            return Err(CreateSessionLinkError::SelfLink);
        }
        if self
            .session_store
            .find_by_id(&input.parent_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_none()
        {
            return Err(CreateSessionLinkError::ParentNotFound(
                input.parent_session_id,
            ));
        }
        if self
            .session_store
            .find_by_id(&input.child_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_none()
        {
            return Err(CreateSessionLinkError::ChildNotFound(
                input.child_session_id,
            ));
        }
        if input.relation == SessionLinkRelation::Subagent {
            if self
                .store
                .find_subagent_link(&input.parent_session_id, &input.child_session_id)
                .map_err(CreateSessionLinkError::Store)?
                .is_some()
            {
                return Err(CreateSessionLinkError::Duplicate);
            }
            if self
                .store
                .find_subagent_parent(&input.child_session_id)
                .map_err(CreateSessionLinkError::Store)?
                .is_some()
            {
                return Err(CreateSessionLinkError::ChildAlreadyLinked);
            }
        }

        let record = SessionLinkRecord {
            id: Uuid::new_v4().to_string(),
            public_id: Some(new_public_id(input.relation)),
            relation: input.relation,
            parent_session_id: input.parent_session_id,
            child_session_id: input.child_session_id,
            workspace_relation: input.workspace_relation,
            label: input.label,
            created_by_turn_id: input.created_by_turn_id,
            created_by_tool_call_id: input.created_by_tool_call_id,
            created_at: chrono::Utc::now().to_rfc3339(),
            closed_at: None,
        };
        self.store.insert(&record).map_err(|error| {
            if is_unique_constraint_error(&error) {
                CreateSessionLinkError::Duplicate
            } else {
                CreateSessionLinkError::Store(error)
            }
        })?;
        Ok(record)
    }

    pub fn create_subagent_link_with_child_limit(
        &self,
        input: CreateSessionLinkInput,
        max_children: usize,
    ) -> Result<SessionLinkRecord, CreateSessionLinkError> {
        if input.relation != SessionLinkRelation::Subagent {
            return self.create_link(input);
        }
        if input.parent_session_id == input.child_session_id {
            return Err(CreateSessionLinkError::SelfLink);
        }
        if self
            .session_store
            .find_by_id(&input.parent_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_none()
        {
            return Err(CreateSessionLinkError::ParentNotFound(
                input.parent_session_id,
            ));
        }
        if self
            .session_store
            .find_by_id(&input.child_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_none()
        {
            return Err(CreateSessionLinkError::ChildNotFound(
                input.child_session_id,
            ));
        }
        if self
            .store
            .find_subagent_link(&input.parent_session_id, &input.child_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_some()
        {
            return Err(CreateSessionLinkError::Duplicate);
        }
        if self
            .store
            .find_subagent_parent(&input.child_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_some()
        {
            return Err(CreateSessionLinkError::ChildAlreadyLinked);
        }

        let record = SessionLinkRecord {
            id: Uuid::new_v4().to_string(),
            public_id: Some(new_public_id(input.relation)),
            relation: input.relation,
            parent_session_id: input.parent_session_id,
            child_session_id: input.child_session_id,
            workspace_relation: input.workspace_relation,
            label: input.label,
            created_by_turn_id: input.created_by_turn_id,
            created_by_tool_call_id: input.created_by_tool_call_id,
            created_at: chrono::Utc::now().to_rfc3339(),
            closed_at: None,
        };
        let outcome = self
            .store
            .insert_subagent_with_child_limit(&record, max_children)
            .map_err(|error| {
                if is_unique_constraint_error(&error) {
                    CreateSessionLinkError::Duplicate
                } else {
                    CreateSessionLinkError::Store(error)
                }
            })?;
        match outcome {
            InsertSubagentLinkOutcome::Inserted => Ok(record),
            InsertSubagentLinkOutcome::FanoutLimit => Err(CreateSessionLinkError::FanoutLimit),
        }
    }

    pub fn list_by_parent(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.store.list_by_parent(parent_session_id)
    }

    pub fn list_by_parent_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.store
            .list_by_parent_including_closed(parent_session_id)
    }

    pub fn list_by_child(&self, child_session_id: &str) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.store.list_by_child(child_session_id)
    }

    pub fn list_by_child_including_closed(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.store.list_by_child_including_closed(child_session_id)
    }

    pub fn list_subagent_children(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.store.list_subagent_children(parent_session_id)
    }

    pub fn find_subagent_parent(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.store.find_subagent_parent(child_session_id)
    }

    pub fn find_subagent_link(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.store
            .find_subagent_link(parent_session_id, child_session_id)
    }

    pub fn find_link_by_relation(
        &self,
        relation: SessionLinkRelation,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.store
            .find_link_by_relation(relation, parent_session_id, child_session_id)
    }

    pub fn find_link_by_relation_including_closed(
        &self,
        relation: SessionLinkRelation,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.store.find_link_by_relation_including_closed(
            relation,
            parent_session_id,
            child_session_id,
        )
    }

    pub fn find_by_public_id(&self, public_id: &str) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.store.find_by_public_id(public_id)
    }

    pub fn close_link(&self, id: &str, closed_at: &str) -> anyhow::Result<bool> {
        self.store.close_link(id, closed_at)
    }

    pub fn delete_link(&self, id: &str) -> anyhow::Result<bool> {
        self.store.delete_by_id(id)
    }

    pub fn list_children_by_relation(
        &self,
        relation: SessionLinkRelation,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.store
            .list_children_by_relation(relation, parent_session_id)
    }

    pub fn find_parent_by_relation(
        &self,
        relation: SessionLinkRelation,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.store
            .find_parent_by_relation(relation, child_session_id)
    }

    pub fn import_link(&self, record: &SessionLinkRecord) -> anyhow::Result<()> {
        let mut record = record.clone();
        if record.public_id.is_none() {
            record.public_id = Some(new_public_id(record.relation));
        }
        self.store.import_link(&record)
    }
}

pub fn new_public_id(relation: SessionLinkRelation) -> String {
    format!(
        "{}_{}",
        relation.public_id_prefix(),
        Uuid::new_v4().simple()
    )
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

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
