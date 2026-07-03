//! ActivityPort wire contract v1 (session-activity-architecture, locked
//! 2026-07-02): the normalized shapes the sidecars/integration modules speak
//! for the read-only activity rosters — `ActivityProcessWire` /
//! `ActivitySubagentWire` payloads on tagged notification chunks
//! (`process_upserted` / `subagent_upserted`). The `feed` transport
//! (`tail_file` / `acp_child_demux` / `http_sse`) travels membrane→runtime
//! ONLY on this wire type — it is swapped for an opaque
//! [`super::model::FeedBindingRecord`] / `FeedRef` before anything leaves
//! the runtime.

use serde::Deserialize;

pub const PROCESS_UPSERTED_TRANSCRIPT_EVENT: &str = "process_upserted";
pub const SUBAGENT_UPSERTED_TRANSCRIPT_EVENT: &str = "subagent_upserted";

/// The attach-time roster reconcile pull (`_anyharness/activity/list`). ACP
/// 0.14 strips the leading `_` before dispatch; the client sends the
/// underscored form.
pub const ACTIVITY_LIST_EXT_METHOD: &str = "_anyharness/activity/list";

/// `_anyharness/activity/list` result: the harness's current roster snapshot.
/// For Codex this re-lists child threads on reattach; harnesses that don't
/// implement it simply return an error and the reset-only path applies.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityListWireResult {
    #[serde(default)]
    pub processes: Vec<ActivityProcessWire>,
    /// Both forks return the roster under `subagents` (claude-agent-acp's
    /// `activity/list`), not `agents`; the old key silently degraded the
    /// reconcile pull to an empty agent list. `alias` keeps any legacy
    /// emitter working.
    #[serde(default, alias = "agents")]
    pub subagents: Vec<ActivitySubagentWire>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityProcessWire {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    pub status: ActivityProcessStatusWire,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub pid: Option<u32>,
    /// Epoch-ms process start — both harness forks emit `startedAtMs` (claude
    /// `startedAtMs: number`, codex `started_at_ms: Option<i64>`), NOT an
    /// RFC3339 `startedAt` string. Optional + defaulted so a codex `None`
    /// degrades to the ingest clock instead of failing the whole chunk;
    /// converted to the contract's RFC3339 `started_at` on ingest.
    #[serde(default)]
    pub started_at_ms: Option<i64>,
    #[serde(default)]
    pub ended_at_ms: Option<i64>,
    #[serde(default)]
    pub feed: Option<FeedTransportWire>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityProcessStatusWire {
    Running,
    Exited,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySubagentWire {
    pub id: String,
    #[serde(default)]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub background: bool,
    pub status: ActivitySubagentStatusWire,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub tokens_used: Option<i64>,
    #[serde(default)]
    pub tool_calls: Option<i64>,
    #[serde(default)]
    pub duration_seconds: Option<i64>,
    #[serde(default)]
    pub feed: Option<FeedTransportWire>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivitySubagentStatusWire {
    Running,
    Completed,
    Failed,
}

/// The feed transport as parsed off the wire — membrane→runtime only, per
/// the ActivityPort framework. Tag values match
/// `harness-runtime-mechanics.md`'s vocabulary verbatim
/// (`tail_file(path)` / `acp_child_demux(thread_id)` / `http_sse(url)`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FeedTransportWire {
    TailFile { path: String },
    AcpChildDemux {
        #[serde(rename = "threadId")]
        thread_id: String,
    },
    HttpSse { url: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_process_wire_parses_running_and_exited() {
        let running: ActivityProcessWire = serde_json::from_value(serde_json::json!({
            "id": "proc-1",
            "command": "sleep 30 && echo OK > out.txt",
            "status": "running",
            "startedAtMs": 1_782_000_000_000_i64
        }))
        .expect("parse running process wire");
        assert_eq!(running.status, ActivityProcessStatusWire::Running);
        assert_eq!(running.started_at_ms, Some(1_782_000_000_000));
        assert!(running.feed.is_none());

        let exited: ActivityProcessWire = serde_json::from_value(serde_json::json!({
            "id": "proc-1",
            "command": "sleep 30 && echo OK > out.txt",
            "status": "exited",
            "exitCode": 0,
            "pid": 4242,
            "startedAtMs": 1_782_000_000_000_i64,
            "endedAtMs": 1_782_000_030_000_i64,
            "feed": { "kind": "tail_file", "path": "/tmp/out.txt" }
        }))
        .expect("parse exited process wire");
        assert_eq!(exited.status, ActivityProcessStatusWire::Exited);
        assert_eq!(exited.exit_code, Some(0));
        assert_eq!(exited.ended_at_ms, Some(1_782_000_030_000));
        assert_eq!(
            exited.feed,
            Some(FeedTransportWire::TailFile {
                path: "/tmp/out.txt".to_string()
            })
        );
    }

    #[test]
    fn activity_subagent_wire_parses_feed_transports() {
        let acp: ActivitySubagentWire = serde_json::from_value(serde_json::json!({
            "id": "child-1",
            "background": true,
            "status": "running",
            "feed": { "kind": "acp_child_demux", "threadId": "child-thread-1" }
        }))
        .expect("parse acp_child_demux subagent wire");
        assert_eq!(
            acp.feed,
            Some(FeedTransportWire::AcpChildDemux {
                thread_id: "child-thread-1".to_string()
            })
        );

        let sse: ActivitySubagentWire = serde_json::from_value(serde_json::json!({
            "id": "child-2",
            "background": false,
            "status": "completed",
            "summary": "done",
            "feed": { "kind": "http_sse", "url": "http://127.0.0.1:9000/session/child-2/events" }
        }))
        .expect("parse http_sse subagent wire");
        assert_eq!(sse.status, ActivitySubagentStatusWire::Completed);
        assert_eq!(sse.summary.as_deref(), Some("done"));
        assert_eq!(
            sse.feed,
            Some(FeedTransportWire::HttpSse {
                url: "http://127.0.0.1:9000/session/child-2/events".to_string()
            })
        );
    }

    #[test]
    fn activity_list_wire_reads_subagents_key_and_agents_alias() {
        // Forks return the roster under `subagents`.
        let via_subagents: ActivityListWireResult = serde_json::from_value(serde_json::json!({
            "processes": [],
            "subagents": [{ "id": "child-1", "background": true, "status": "running" }]
        }))
        .expect("parse subagents");
        assert_eq!(via_subagents.subagents.len(), 1);

        // Legacy `agents` key still accepted via alias.
        let via_alias: ActivityListWireResult = serde_json::from_value(serde_json::json!({
            "agents": [{ "id": "child-1", "background": true, "status": "running" }]
        }))
        .expect("parse agents alias");
        assert_eq!(via_alias.subagents.len(), 1);
    }
}
