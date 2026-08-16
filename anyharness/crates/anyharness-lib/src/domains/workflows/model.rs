//! Row records and status vocabulary for the gen-2 workflow tables. The
//! failure vocabulary on rows is distinct from HTTP error codes: node
//! `failure_code` says why a node failed, run `interruption_code` says why a
//! run parked recoverable.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowRunStatus {
    Running,
    AwaitingHuman,
    Interrupted,
    Completed,
    Failed,
    Cancelled,
}

impl WorkflowRunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::AwaitingHuman => "awaiting_human",
            Self::Interrupted => "interrupted",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "running" => Some(Self::Running),
            "awaiting_human" => Some(Self::AwaitingHuman),
            "interrupted" => Some(Self::Interrupted),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowNodeStatus {
    Pending,
    Running,
    NeedsAttention,
    AwaitingHuman,
    Completed,
    Failed,
    Cancelled,
}

impl WorkflowNodeStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::NeedsAttention => "needs_attention",
            Self::AwaitingHuman => "awaiting_human",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "running" => Some(Self::Running),
            "needs_attention" => Some(Self::NeedsAttention),
            "awaiting_human" => Some(Self::AwaitingHuman),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }

    /// The invariant sweep's "active" set: at most one node row per run may be
    /// in one of these states.
    pub fn is_active(&self) -> bool {
        matches!(
            self,
            Self::Running | Self::AwaitingHuman | Self::NeedsAttention
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowNodeKind {
    Defined,
    Replacement,
    Adhoc,
}

impl WorkflowNodeKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Defined => "defined",
            Self::Replacement => "replacement",
            Self::Adhoc => "adhoc",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "defined" => Some(Self::Defined),
            "replacement" => Some(Self::Replacement),
            "adhoc" => Some(Self::Adhoc),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowNodeType {
    Agent,
    HumanInLoop,
}

impl WorkflowNodeType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::HumanInLoop => "human_in_loop",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "agent" => Some(Self::Agent),
            "human_in_loop" => Some(Self::HumanInLoop),
            _ => None,
        }
    }
}

/// Node failure vocabulary (rows, never HTTP). `superseded` marks a row a
/// fail-and-redo replaced from a non-failed pause state, so the failed⇔code
/// row law holds on every failed row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowNodeFailureCode {
    NodeLaunchFailed,
    TurnError,
    Refusal,
    EmptyTurn,
    HarnessCap,
    Superseded,
}

impl WorkflowNodeFailureCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NodeLaunchFailed => "node_launch_failed",
            Self::TurnError => "turn_error",
            Self::Refusal => "refusal",
            Self::EmptyTurn => "empty_turn",
            Self::HarnessCap => "harness_cap",
            Self::Superseded => "superseded",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "node_launch_failed" => Some(Self::NodeLaunchFailed),
            "turn_error" => Some(Self::TurnError),
            "refusal" => Some(Self::Refusal),
            "empty_turn" => Some(Self::EmptyTurn),
            "harness_cap" => Some(Self::HarnessCap),
            "superseded" => Some(Self::Superseded),
            _ => None,
        }
    }
}

/// Run interruption vocabulary: recoverable parks, offered by the resume
/// popover. `runtime_restarted` is inherited from gen-1's boot fence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowInterruptionCode {
    UserCancel,
    AppShutdown,
    RuntimeRestarted,
}

impl WorkflowInterruptionCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UserCancel => "user_cancel",
            Self::AppShutdown => "app_shutdown",
            Self::RuntimeRestarted => "runtime_restarted",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "user_cancel" => Some(Self::UserCancel),
            "app_shutdown" => Some(Self::AppShutdown),
            "runtime_restarted" => Some(Self::RuntimeRestarted),
            _ => None,
        }
    }
}

/// The stored, re-creatable prompt unit: retry, fail-and-redo, and ad hoc
/// re-running all reuse the same rendering. Persisted as JSON in
/// `workflow_run_nodes.rendered_envelope`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedEnvelope {
    /// Instruction blocks prepended in-band to the first message payload,
    /// stored ALREADY wrapped with the exact house sentinel ("System
    /// instruction from AnyHarness, not user content:") — Ruling D.
    pub instruction_blocks: Vec<String>,
    pub first_message: String,
    /// Reserved for DSL-authored appends; the preamble never rides here
    /// (Ruling D), so no harness can receive it twice.
    pub system_prompt_append: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowRunRecord {
    pub id: String,
    pub invocation_id: String,
    pub definition_json: String,
    pub arguments_json: String,
    pub workspace_id: String,
    pub status: WorkflowRunStatus,
    pub current_node_row_id: Option<String>,
    pub failure_code: Option<String>,
    pub interruption_code: Option<WorkflowInterruptionCode>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowRunNodeRecord {
    pub id: String,
    pub run_id: String,
    pub definition_node_id: Option<String>,
    pub kind: WorkflowNodeKind,
    pub node_type: WorkflowNodeType,
    pub replaces_node_row_id: Option<String>,
    pub anchor_node_row_id: Option<String>,
    pub chain_index: Option<i64>,
    pub title: String,
    pub prompt: String,
    pub status: WorkflowNodeStatus,
    pub session_id: Option<String>,
    pub prompt_id: Option<String>,
    /// The row's own launch pick — set for adhoc nodes (and inherited by their
    /// redo replacements, Ruling K.1). It wins over any definition resolution;
    /// `None` means resolve via `definition_node_id`, then the app default.
    pub model: Option<super::definition::NodeModel>,
    pub rendered_envelope: Option<RenderedEnvelope>,
    pub failure_code: Option<WorkflowNodeFailureCode>,
    /// Stamped when this node's session finishes its FIRST turn of the current
    /// execution; cleared whenever the node (re)starts fresh. UndoAdvance is
    /// legal only while the successor has not finished a turn (Ruling J).
    pub first_turn_finished_at: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

impl WorkflowRunNodeRecord {
    /// The node's session title: the graph card's own index line — one-based
    /// chain position, zero-padded to two digits, "--" for a row with no
    /// position — so the header tab, the roster, and the card all name the
    /// node identically (`nodeIndexTitle` in the client's node-card copy).
    pub fn session_title(&self) -> String {
        let index_label = match self.chain_index {
            Some(index) => format!("{:02}", index + 1),
            None => "--".to_string(),
        };
        format!("{index_label} · {}", self.title)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowRunDocRecord {
    pub id: String,
    pub run_id: String,
    pub slug: String,
    pub filename: String,
    pub producing_node_row_id: Option<String>,
    pub seeded_from_template: bool,
    pub created_at: String,
    pub updated_at: String,
}
