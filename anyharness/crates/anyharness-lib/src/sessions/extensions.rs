use anyharness_contract::v1::{ErrorEventDetails, SessionMcpBindingSummary};

use crate::sessions::mcp::SessionMcpServer;
use crate::workspaces::model::WorkspaceRecord;

use super::model::SessionRecord;

#[derive(Debug, Clone, Default)]
pub struct SessionLaunchExtras {
    pub system_prompt_append: Vec<String>,
    pub first_prompt_system_prompt_append: Vec<String>,
    pub mcp_servers: Vec<SessionMcpServer>,
    pub mcp_binding_summaries: Vec<SessionMcpBindingSummary>,
}

#[derive(Debug)]
pub struct SessionLaunchContext<'a> {
    pub workspace: &'a WorkspaceRecord,
    pub session: &'a SessionRecord,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionTurnOutcome {
    Completed,
    Failed,
    Cancelled,
}

impl SessionTurnOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionTurnFinishedContext {
    pub workspace: WorkspaceRecord,
    pub session_id: String,
    pub turn_id: String,
    pub outcome: SessionTurnOutcome,
    pub stop_reason: Option<String>,
    pub last_event_seq: i64,
    pub error_details: Option<ErrorEventDetails>,
}

pub trait SessionExtension: Send + Sync {
    fn resolve_launch_extras(
        &self,
        _ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        Ok(SessionLaunchExtras::default())
    }

    fn on_turn_finished(&self, _ctx: SessionTurnFinishedContext) {}
}
