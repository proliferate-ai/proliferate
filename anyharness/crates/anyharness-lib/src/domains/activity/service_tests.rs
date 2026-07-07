use std::sync::Arc;

use anyharness_contract::v1::{FeedKind, ProcessStatus, SessionEvent, SubagentStatus};
use serde_json::json;

use super::service::{ActivityEventContext, ActivityService};
use super::session_observer::ActivitySessionObserver;
use super::store::ActivityStore;
use super::wire::{ActivityProcessStatusWire, ActivityProcessWire, ActivitySubagentStatusWire, ActivitySubagentWire, FeedTransportWire};
use crate::app::test_support;
use crate::live::sessions::model::{
    AcpChunkPayload, SessionEventObserver, SessionObservation, SessionObserverContext,
};
use crate::persistence::Db;

fn test_service() -> ActivityService {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sessions (
                id, workspace_id, agent_kind, status, created_at, updated_at
             ) VALUES ('session-1', 'workspace-1', 'claude', 'idle', 'now', 'now')",
            [],
        )?;
        Ok(())
    })
    .expect("seed db");
    ActivityService::new(ActivityStore::new(db))
}

fn context(next_seq: i64) -> ActivityEventContext {
    ActivityEventContext {
        workspace_id: "workspace-1".to_string(),
        session_id: "session-1".to_string(),
        source_agent_kind: "claude".to_string(),
        turn_id: Some("turn-1".to_string()),
        next_seq,
    }
}

fn process_wire(id: &str, status: ActivityProcessStatusWire) -> ActivityProcessWire {
    ActivityProcessWire {
        id: id.to_string(),
        command: "sleep 30 && echo OK > out.txt".to_string(),
        cwd: None,
        status,
        exit_code: None,
        pid: None,
        started_at: "2026-07-02T00:00:00Z".to_string(),
        ended_at: None,
        feed: None,
    }
}

#[test]
fn ingest_process_upserted_creates_the_roster_row() {
    let service = test_service();
    let batch = service
        .ingest_process_upserted(context(1), process_wire("proc-1", ActivityProcessStatusWire::Running))
        .expect("ingest process");

    assert_eq!(batch.envelopes.len(), 1);
    assert_eq!(batch.envelopes[0].event.event_type(), "process_upserted");
    let SessionEvent::ActivityProcessUpserted(payload) = &batch.envelopes[0].event else {
        panic!("expected process_upserted event");
    };
    assert_eq!(payload.process.id, "proc-1");
    assert_eq!(payload.process.status, ProcessStatus::Running);

    let processes = service.current_processes("session-1").expect("load processes");
    assert_eq!(processes.len(), 1);
    assert_eq!(processes[0].id, "proc-1");
}

#[test]
fn ingest_process_upserted_transitions_running_to_exited() {
    let service = test_service();
    service
        .ingest_process_upserted(context(1), process_wire("proc-1", ActivityProcessStatusWire::Running))
        .expect("ingest running");

    let mut exited = process_wire("proc-1", ActivityProcessStatusWire::Exited);
    exited.exit_code = Some(0);
    exited.ended_at = Some("2026-07-02T00:00:30Z".to_string());
    service
        .ingest_process_upserted(context(2), exited)
        .expect("ingest exited");

    let processes = service.current_processes("session-1").expect("load processes");
    assert_eq!(processes.len(), 1);
    assert_eq!(
        processes[0].status,
        ProcessStatus::Exited { exit_code: Some(0) }
    );
}

#[test]
fn ingest_process_upserted_binds_a_stable_feed_ref_across_updates() {
    let service = test_service();
    let mut wire = process_wire("proc-1", ActivityProcessStatusWire::Running);
    wire.feed = Some(FeedTransportWire::TailFile {
        path: "/tmp/out.txt".to_string(),
    });
    let first = service
        .ingest_process_upserted(context(1), wire.clone())
        .expect("ingest with feed");
    let SessionEvent::ActivityProcessUpserted(first_payload) = &first.envelopes[0].event else {
        panic!("expected process_upserted event");
    };
    let feed = first_payload.process.feed.clone().expect("feed ref");
    assert_eq!(feed.kind, FeedKind::TerminalBytes);

    wire.status = ActivityProcessStatusWire::Exited;
    wire.exit_code = Some(0);
    let second = service.ingest_process_upserted(context(2), wire).expect("ingest again");
    let SessionEvent::ActivityProcessUpserted(second_payload) = &second.envelopes[0].event else {
        panic!("expected process_upserted event");
    };
    let second_feed = second_payload.process.feed.clone().expect("feed ref still present");
    assert_eq!(second_feed.feed_id, feed.feed_id);
}

#[test]
fn ingest_subagent_upserted_creates_the_roster_row_with_usage() {
    let service = test_service();
    let wire = ActivitySubagentWire {
        id: "agent-1".to_string(),
        agent_type: Some("reviewer".to_string()),
        description: Some("Reviewing the diff".to_string()),
        model: Some("claude-sonnet".to_string()),
        background: true,
        status: ActivitySubagentStatusWire::Running,
        summary: None,
        tokens_used: Some(1200),
        tool_calls: Some(3),
        duration_seconds: Some(42),
        feed: None,
    };
    let batch = service
        .ingest_subagent_upserted(context(1), wire)
        .expect("ingest subagent");

    assert_eq!(batch.envelopes.len(), 1);
    assert_eq!(batch.envelopes[0].event.event_type(), "subagent_upserted");
    let SessionEvent::ActivitySubagentUpserted(payload) = &batch.envelopes[0].event else {
        panic!("expected subagent_upserted event");
    };
    assert_eq!(payload.agent.status, SubagentStatus::Running);
    let usage = payload.agent.usage.clone().expect("usage present");
    assert_eq!(usage.tokens_used, Some(1200));

    let agents = service.current_agents("session-1").expect("load agents");
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].id, "agent-1");
}

// ---------------------------------------------------------------------------
// Observer ingestion (fixture chunks)
// ---------------------------------------------------------------------------

fn observer_context(next_seq: i64) -> SessionObserverContext {
    SessionObserverContext {
        session_id: "session-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        turn_id: Some("turn-1".to_string()),
        next_seq,
    }
}

fn activity_chunk(meta: serde_json::Value) -> AcpChunkPayload {
    AcpChunkPayload {
        content: json!({ "type": "text", "text": "" }),
        meta: Some(meta),
        message_id: None,
    }
}

#[test]
fn observer_ingests_process_upserted_chunk() {
    let service = Arc::new(test_service());
    let observer = ActivitySessionObserver::new(service.clone());

    let payload = activity_chunk(json!({
        "anyharness": {
            "schemaVersion": 1,
            "transcriptEvent": "process_upserted",
            "process": {
                "id": "proc-1",
                "command": "sleep 30 && echo OK > out.txt",
                "status": "running",
                "startedAt": "2026-07-02T00:00:00Z",
                "feed": { "kind": "tail_file", "path": "/tmp/out.txt" }
            }
        }
    }));
    let effects = observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&payload),
    );

    assert_eq!(effects.persisted_events.len(), 1);
    assert_eq!(effects.persisted_events[0].event.event_type(), "process_upserted");
    let processes = service.current_processes("session-1").expect("load processes");
    assert_eq!(processes.len(), 1);
    assert!(processes[0].feed.is_some());
}

#[test]
fn observer_ingests_subagent_upserted_chunk() {
    let service = Arc::new(test_service());
    let observer = ActivitySessionObserver::new(service.clone());

    let payload = activity_chunk(json!({
        "anyharness": {
            "schemaVersion": 1,
            "transcriptEvent": "subagent_upserted",
            "agent": {
                "id": "agent-1",
                "background": false,
                "status": "completed",
                "summary": "Found 2 bugs",
                "feed": { "kind": "acp_child_demux", "threadId": "child-thread-1" }
            }
        }
    }));
    let effects = observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&payload),
    );

    assert_eq!(effects.persisted_events.len(), 1);
    assert_eq!(effects.persisted_events[0].event.event_type(), "subagent_upserted");
    let agents = service.current_agents("session-1").expect("load agents");
    assert_eq!(agents.len(), 1);
    assert_eq!(
        agents[0].status,
        SubagentStatus::Completed {
            summary: Some("Found 2 bugs".to_string())
        }
    );
    let feed = agents[0].feed.clone().expect("feed ref");
    assert_eq!(feed.kind, FeedKind::Transcript);
}

#[test]
fn observer_ignores_unrelated_and_malformed_chunks() {
    let service = Arc::new(test_service());
    let observer = ActivitySessionObserver::new(service.clone());

    let plan_chunk = activity_chunk(json!({
        "anyharness": { "transcriptEvent": "proposed_plan_completed" }
    }));
    let effects = observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&plan_chunk),
    );
    assert!(effects.persisted_events.is_empty());

    let malformed = activity_chunk(json!({
        "anyharness": {
            "schemaVersion": 1,
            "transcriptEvent": "process_upserted",
            "process": { "id": "proc-1", "status": "not-a-status" }
        }
    }));
    let effects = observer.observe(
        &observer_context(1),
        SessionObservation::NonTranscriptChunk(&malformed),
    );
    assert!(effects.persisted_events.is_empty());
    assert!(service
        .current_processes("session-1")
        .expect("load processes")
        .is_empty());
}
