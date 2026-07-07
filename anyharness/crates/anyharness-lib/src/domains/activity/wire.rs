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
    pub started_at: String,
    #[serde(default)]
    pub ended_at: Option<String>,
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
            "startedAt": "2026-07-02T00:00:00Z"
        }))
        .expect("parse running process wire");
        assert_eq!(running.status, ActivityProcessStatusWire::Running);
        assert!(running.feed.is_none());

        let exited: ActivityProcessWire = serde_json::from_value(serde_json::json!({
            "id": "proc-1",
            "command": "sleep 30 && echo OK > out.txt",
            "status": "exited",
            "exitCode": 0,
            "pid": 4242,
            "startedAt": "2026-07-02T00:00:00Z",
            "endedAt": "2026-07-02T00:00:30Z",
            "feed": { "kind": "tail_file", "path": "/tmp/out.txt" }
        }))
        .expect("parse exited process wire");
        assert_eq!(exited.status, ActivityProcessStatusWire::Exited);
        assert_eq!(exited.exit_code, Some(0));
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
}
