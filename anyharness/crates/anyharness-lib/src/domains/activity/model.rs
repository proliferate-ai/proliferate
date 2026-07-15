use anyharness_contract::v1::{
    ActivityProcess, ActivitySubagent, ActivityUsage, FeedKind, FeedRef, ProcessStatus,
    SubagentStatus,
};

/// Read-only roster element: a harness-owned or client-executed background
/// process. Never externally settable — records transition only through
/// observer-ingested native notifications
/// ([`super::session_observer::ActivitySessionObserver`]).
#[derive(Debug, Clone)]
pub struct ActivityProcessRecord {
    pub session_id: String,
    pub workspace_id: String,
    pub process_id: String,
    pub command: String,
    pub cwd: Option<String>,
    pub status: ProcessRunStatus,
    pub exit_code: Option<i32>,
    pub pid: Option<u32>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub feed_id: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessRunStatus {
    Running,
    Exited,
}

impl ActivityProcessRecord {
    /// Background processes always stream raw bytes — the `feed_id` (when
    /// bound) resolves to a [`FeedKind::TerminalBytes`] feed.
    pub fn to_contract(&self) -> ActivityProcess {
        ActivityProcess {
            id: self.process_id.clone(),
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            status: match self.status {
                ProcessRunStatus::Running => ProcessStatus::Running,
                ProcessRunStatus::Exited => ProcessStatus::Exited {
                    exit_code: self.exit_code,
                },
            },
            pid: self.pid,
            started_at: self.started_at.clone(),
            ended_at: self.ended_at.clone(),
            feed: self.feed_id.clone().map(|feed_id| FeedRef {
                feed_id,
                kind: FeedKind::TerminalBytes,
            }),
        }
    }
}

/// Read-only roster element: a harness-native subagent (Claude Task agent,
/// Codex collab child thread, Cursor `cursor/task`). Never externally
/// settable.
#[derive(Debug, Clone)]
pub struct ActivitySubagentRecord {
    pub session_id: String,
    pub workspace_id: String,
    pub subagent_id: String,
    pub agent_type: Option<String>,
    pub description: Option<String>,
    pub model: Option<String>,
    pub background: bool,
    pub status: SubagentRunStatus,
    pub summary: Option<String>,
    pub tokens_used: Option<i64>,
    pub tool_calls: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub feed_id: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubagentRunStatus {
    Running,
    Completed,
    Failed,
}

impl ActivitySubagentRecord {
    /// Subagents always stream a nested transcript — the `feed_id` (when
    /// bound) resolves to a [`FeedKind::Transcript`] feed.
    pub fn to_contract(&self) -> ActivitySubagent {
        let usage = if self.tokens_used.is_some()
            || self.tool_calls.is_some()
            || self.duration_seconds.is_some()
        {
            Some(ActivityUsage {
                tokens_used: self.tokens_used,
                tool_calls: self.tool_calls,
                duration_seconds: self.duration_seconds,
            })
        } else {
            None
        };
        ActivitySubagent {
            id: self.subagent_id.clone(),
            agent_type: self.agent_type.clone(),
            description: self.description.clone(),
            model: self.model.clone(),
            background: self.background,
            status: match self.status {
                SubagentRunStatus::Running => SubagentStatus::Running,
                SubagentRunStatus::Completed => SubagentStatus::Completed {
                    summary: self.summary.clone(),
                },
                SubagentRunStatus::Failed => SubagentStatus::Failed,
            },
            usage,
            feed: self.feed_id.clone().map(|feed_id| FeedRef {
                feed_id,
                kind: FeedKind::Transcript,
            }),
        }
    }
}

/// Which roster element owns a [`FeedBindingRecord`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeedOwnerKind {
    Process,
    Subagent,
}

impl FeedOwnerKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Process => "process",
            Self::Subagent => "subagent",
        }
    }
}

/// The transport detail a `FeedRef` resolves to — internal-only, never
/// serialized to the contract. `tail_file` / `acp_child_demux` / `http_sse`
/// per the session-activity-architecture membrane framework.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeedTransport {
    TailFile { path: String },
    AcpChildDemux { thread_id: String },
    HttpSse { url: String },
}

/// One row per roster element's live content stream: the opaque `feed_id`
/// exposed as [`FeedRef`] plus the transport detail that never leaves the
/// runtime.
#[derive(Debug, Clone)]
pub struct FeedBindingRecord {
    pub feed_id: String,
    pub session_id: String,
    pub kind: FeedKind,
    pub owner_kind: FeedOwnerKind,
    pub owner_id: String,
    pub transport: FeedTransport,
    pub created_at: String,
    pub updated_at: String,
}

impl FeedBindingRecord {
    pub fn to_feed_ref(&self) -> FeedRef {
        FeedRef {
            feed_id: self.feed_id.clone(),
            kind: self.kind,
        }
    }
}
