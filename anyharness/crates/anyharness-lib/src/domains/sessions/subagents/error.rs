//! The failure taxonomy for subagent operations.
//!
//! Split out of `service.rs` so the service file keeps to the operations and
//! the error surface has one place to grow.

use crate::domains::sessions::links::service::CreateSessionLinkError;
use crate::domains::workspaces::access_gate::WorkspaceAccessError;

#[derive(Debug, thiserror::Error)]
pub enum SubagentError {
    #[error("parent session not found: {0}")]
    ParentNotFound(String),
    #[error("child session not found: {0}")]
    ChildNotFound(String),
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("subagents are only available in standard workspaces")]
    IneligibleWorkspace,
    #[error("subagent child must be in the same workspace")]
    CrossWorkspace,
    #[error("subagent children cannot create subagents")]
    DepthLimit,
    #[error("subagents are disabled for this session")]
    Disabled,
    #[error("parent already has the maximum number of subagents")]
    FanoutLimit,
    #[error("child session is not owned by parent")]
    NotOwned,
    #[error("subagent target is required")]
    TargetRequired,
    #[error("subagentId and childSessionId refer to different subagents")]
    ConflictingTarget,
    #[error("subagent is closed")]
    Closed,
    #[error("workspace mutation blocked: {0}")]
    MutationBlocked(String),
    #[error(transparent)]
    Link(#[from] CreateSessionLinkError),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl SubagentError {
    /// Stable low-cardinality reason for observability. The typed rejections
    /// are otherwise invisible: the caller only ever sees the rendered string.
    pub fn reason_label(&self) -> &'static str {
        match self {
            SubagentError::ParentNotFound(_) => "parent_not_found",
            SubagentError::ChildNotFound(_) => "child_not_found",
            SubagentError::WorkspaceNotFound(_) => "workspace_not_found",
            SubagentError::IneligibleWorkspace => "ineligible_workspace",
            SubagentError::CrossWorkspace => "cross_workspace",
            SubagentError::DepthLimit => "depth_limit",
            SubagentError::Disabled => "disabled",
            SubagentError::FanoutLimit => "fanout_limit",
            SubagentError::NotOwned => "not_owned",
            SubagentError::TargetRequired => "target_required",
            SubagentError::ConflictingTarget => "conflicting_target",
            SubagentError::Closed => "closed",
            SubagentError::MutationBlocked(_) => "mutation_blocked",
            SubagentError::Link(_) => "link_failed",
            SubagentError::Internal(_) => "internal",
        }
    }
}

pub(super) fn map_access_error(error: WorkspaceAccessError) -> SubagentError {
    SubagentError::MutationBlocked(error.to_string())
}
