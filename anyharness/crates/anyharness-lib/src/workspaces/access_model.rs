use anyharness_contract::v1::{
    WorkspaceMobilityRuntimeMode, WorkspaceMobilityRuntimeState,
};

use super::model::WorkspaceRecord;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceAccessMode {
    Normal,
    FrozenForHandoff,
    RemoteOwned,
}

impl WorkspaceAccessMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::FrozenForHandoff => "frozen_for_handoff",
            Self::RemoteOwned => "remote_owned",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "frozen_for_handoff" => Self::FrozenForHandoff,
            "remote_owned" => Self::RemoteOwned,
            _ => Self::Normal,
        }
    }

    pub fn to_contract(self) -> WorkspaceMobilityRuntimeMode {
        match self {
            Self::Normal => WorkspaceMobilityRuntimeMode::Normal,
            Self::FrozenForHandoff => WorkspaceMobilityRuntimeMode::FrozenForHandoff,
            Self::RemoteOwned => WorkspaceMobilityRuntimeMode::RemoteOwned,
        }
    }

    pub fn from_contract(mode: WorkspaceMobilityRuntimeMode) -> Self {
        match mode {
            WorkspaceMobilityRuntimeMode::Normal => Self::Normal,
            WorkspaceMobilityRuntimeMode::FrozenForHandoff => Self::FrozenForHandoff,
            WorkspaceMobilityRuntimeMode::RemoteOwned => Self::RemoteOwned,
        }
    }
}

impl std::fmt::Display for WorkspaceAccessMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone)]
pub struct WorkspaceAccessRecord {
    pub workspace_id: String,
    pub mode: WorkspaceAccessMode,
    pub handoff_op_id: Option<String>,
    pub updated_at: String,
}

impl WorkspaceAccessRecord {
    pub fn to_contract(&self) -> WorkspaceMobilityRuntimeState {
        WorkspaceMobilityRuntimeState {
            workspace_id: self.workspace_id.clone(),
            mode: self.mode.to_contract(),
            handoff_op_id: self.handoff_op_id.clone(),
            updated_at: self.updated_at.clone(),
        }
    }

    pub fn normal_for_workspace(workspace: &WorkspaceRecord) -> Self {
        Self {
            workspace_id: workspace.id.clone(),
            mode: WorkspaceAccessMode::Normal,
            handoff_op_id: None,
            updated_at: workspace.updated_at.clone(),
        }
    }
}
