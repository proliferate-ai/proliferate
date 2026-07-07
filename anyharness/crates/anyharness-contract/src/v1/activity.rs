use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{Goal, Loop};

/// One normalized, strictly-typed, per-session aggregate: the single answer
/// to "what is this agent doing right now" (session-activity-architecture,
/// locked 2026-07-02). Two element classes: mirrors with write paths
/// (`goal`, `loops`) and read-only rosters (`processes`, `agents`), each
/// roster element carrying an opaque [`FeedRef`] for its live content
/// stream — the UI never learns the transport.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionActivity {
    pub turn: TurnState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal: Option<Goal>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub loops: Vec<Loop>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub processes: Vec<ActivityProcess>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agents: Vec<ActivitySubagent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum TurnState {
    Running {
        turn_id: String,
        started_at: String,
    },
    Idle,
}

/// A harness-owned or client-executed process the agent is running in the
/// background (Claude background bash, Cursor detached terminals, …).
/// Read-only roster element — never externally settable.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityProcess {
    pub id: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    pub status: ProcessStatus,
    /// Cursor provides a real pid; Claude does not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feed: Option<FeedRef>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ProcessStatus {
    Running,
    Exited {
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
    },
}

/// A harness-native subagent (Claude Task agent, Codex collab child thread,
/// Cursor `cursor/task`). Read-only roster element; the ⑂ chip routes to the
/// existing delegated-work surfaces.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySubagent {
    /// Claude `task_id` / Codex child `threadId` / Cursor `agentId`.
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub background: bool,
    pub status: SubagentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<ActivityUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feed: Option<FeedRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum SubagentStatus {
    Running,
    Completed {
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
    },
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivityUsage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_used: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<i64>,
}

/// An opaque handle to a roster element's live content stream. The UI never
/// learns the transport (`tail_file` / `acp_child_demux` / `http_sse`) — that
/// detail stays inside the runtime's `FeedBinding` table and is resolved
/// lazily by the `FeedService` only while a panel watches it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeedRef {
    pub feed_id: String,
    pub kind: FeedKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FeedKind {
    TerminalBytes,
    Transcript,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turn_state_serializes_running_and_idle() {
        let running = TurnState::Running {
            turn_id: "turn-1".to_string(),
            started_at: "2026-07-02T00:00:00Z".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&running).expect("serialize running"),
            serde_json::json!({
                "status": "running",
                "turnId": "turn-1",
                "startedAt": "2026-07-02T00:00:00Z"
            })
        );

        let idle = TurnState::Idle;
        assert_eq!(
            serde_json::to_value(&idle).expect("serialize idle"),
            serde_json::json!({ "status": "idle" })
        );
    }

    #[test]
    fn process_status_serializes_running_and_exited() {
        assert_eq!(
            serde_json::to_value(ProcessStatus::Running).expect("serialize running"),
            serde_json::json!({ "status": "running" })
        );
        assert_eq!(
            serde_json::to_value(ProcessStatus::Exited { exit_code: Some(0) })
                .expect("serialize exited"),
            serde_json::json!({ "status": "exited", "exitCode": 0 })
        );
    }

    #[test]
    fn feed_ref_round_trips() {
        let feed = FeedRef {
            feed_id: "feed-1".to_string(),
            kind: FeedKind::TerminalBytes,
        };
        let json = serde_json::to_value(&feed).expect("serialize feed ref");
        assert_eq!(
            json,
            serde_json::json!({ "feedId": "feed-1", "kind": "terminal_bytes" })
        );
        let round_tripped: FeedRef = serde_json::from_value(json).expect("deserialize feed ref");
        assert_eq!(round_tripped, feed);
    }

    #[test]
    fn session_activity_round_trips_with_empty_rosters() {
        let activity = SessionActivity {
            turn: TurnState::Idle,
            goal: None,
            loops: Vec::new(),
            processes: Vec::new(),
            agents: Vec::new(),
        };
        let json = serde_json::to_value(&activity).expect("serialize session activity");
        assert_eq!(
            json,
            serde_json::json!({ "turn": { "status": "idle" } })
        );
    }
}
