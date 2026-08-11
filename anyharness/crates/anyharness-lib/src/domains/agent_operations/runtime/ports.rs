use async_trait::async_trait;

use crate::domains::sessions::links::model::SessionLinkRecord;
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::model::{SessionExecutionState, SessionRecord};
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::service::SessionService;

pub trait AgentSessionReads: Send + Sync {
    fn get_session(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>>;
    fn list_sessions(&self) -> anyhow::Result<Vec<SessionRecord>>;
}

impl AgentSessionReads for SessionService {
    fn get_session(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>> {
        self.get_session(session_id)
    }

    fn list_sessions(&self) -> anyhow::Result<Vec<SessionRecord>> {
        self.list_sessions(None, false)
    }
}

pub trait SubagentRelationshipReads: Send + Sync {
    fn find_parent_including_closed(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>>;

    fn list_children_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>>;
}

impl SubagentRelationshipReads for SessionLinkService {
    fn find_parent_including_closed(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.find_subagent_parent_including_closed(child_session_id)
    }

    fn list_children_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.list_subagent_children_including_closed(parent_session_id)
    }
}

#[async_trait]
pub trait AgentExecutionReads: Send + Sync {
    async fn execution_state(
        &self,
        session: &SessionRecord,
    ) -> anyhow::Result<SessionExecutionState>;
}

#[async_trait]
impl AgentExecutionReads for SessionRuntime {
    async fn execution_state(
        &self,
        session: &SessionRecord,
    ) -> anyhow::Result<SessionExecutionState> {
        Ok(self.session_execution_state(session).await)
    }
}
