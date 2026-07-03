use std::collections::HashMap;

use anyharness_contract::v1::{
    ActivityProcess, ActivityProcessUpsertedPayload, ActivitySubagent,
    ActivitySubagentUpsertedPayload, FeedKind, SessionEvent, SessionEventEnvelope,
};

use super::model::{
    ActivityProcessRecord, ActivitySubagentRecord, FeedBindingRecord, FeedOwnerKind,
    FeedTransport, ProcessRunStatus, SubagentRunStatus,
};
use super::store::ActivityStore;
use super::wire::{
    ActivityProcessStatusWire, ActivityProcessWire, ActivitySubagentStatusWire,
    ActivitySubagentWire, FeedTransportWire,
};
use crate::domains::sessions::model::SessionEventRecord;

#[derive(Debug, Clone)]
pub struct ActivityEventContext {
    pub workspace_id: String,
    pub session_id: String,
    pub source_agent_kind: String,
    pub turn_id: Option<String>,
    pub next_seq: i64,
}

#[derive(Debug, Clone, Default)]
pub struct ActivityEventBatch {
    pub envelopes: Vec<SessionEventEnvelope>,
}

#[derive(Debug, thiserror::Error)]
pub enum ActivityIngestError {
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

/// Mirror-keeping over the read-only activity rosters (background processes
/// + harness-native subagents). Unlike goals/loops there is no external
/// write path at all — every record transitions ONLY through the
/// native-notification ingest paths here
/// ([`super::session_observer::ActivitySessionObserver`]).
#[derive(Clone)]
pub struct ActivityService {
    store: ActivityStore,
}

impl ActivityService {
    pub fn new(store: ActivityStore) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &ActivityStore {
        &self.store
    }

    pub fn current_processes(&self, session_id: &str) -> anyhow::Result<Vec<ActivityProcess>> {
        Ok(self
            .store
            .list_processes(session_id)?
            .iter()
            .map(ActivityProcessRecord::to_contract)
            .collect())
    }

    pub fn current_agents(&self, session_id: &str) -> anyhow::Result<Vec<ActivitySubagent>> {
        Ok(self
            .store
            .list_subagents(session_id)?
            .iter()
            .map(ActivitySubagentRecord::to_contract)
            .collect())
    }

    pub fn current_roster(
        &self,
        session_id: &str,
    ) -> anyhow::Result<(Vec<ActivityProcess>, Vec<ActivitySubagent>)> {
        Ok((
            self.current_processes(session_id)?,
            self.current_agents(session_id)?,
        ))
    }

    pub fn current_rosters_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<HashMap<String, (Vec<ActivityProcess>, Vec<ActivitySubagent>)>> {
        Ok(self
            .store
            .list_rosters_for_sessions(session_ids)?
            .into_iter()
            .map(|(session_id, (processes, subagents))| {
                (
                    session_id,
                    (
                        processes.iter().map(ActivityProcessRecord::to_contract).collect(),
                        subagents.iter().map(ActivitySubagentRecord::to_contract).collect(),
                    ),
                )
            })
            .collect())
    }

    /// Ingests one `process_upserted` tagged-chunk payload: upserts the
    /// process row (and its feed binding, if a transport was carried) and
    /// persists the matching contract event in one transaction.
    pub fn ingest_process_upserted(
        &self,
        context: ActivityEventContext,
        wire: ActivityProcessWire,
    ) -> Result<ActivityEventBatch, ActivityIngestError> {
        self.store
            .with_tx_anyhow(|tx| {
                let envelope = upsert_process_in_tx(tx, &context, wire, context.next_seq)?;
                Ok(ActivityEventBatch {
                    envelopes: vec![envelope],
                })
            })
            .map_err(ActivityIngestError::Store)
    }

    /// Ingests one `subagent_upserted` tagged-chunk payload.
    pub fn ingest_subagent_upserted(
        &self,
        context: ActivityEventContext,
        wire: ActivitySubagentWire,
    ) -> Result<ActivityEventBatch, ActivityIngestError> {
        self.store
            .with_tx_anyhow(|tx| {
                let envelope = upsert_subagent_in_tx(tx, &context, wire, context.next_seq)?;
                Ok(ActivityEventBatch {
                    envelopes: vec![envelope],
                })
            })
            .map_err(ActivityIngestError::Store)
    }

    /// Detach/reattach reset (Claude semantics): every still-`running` process
    /// is process-bound and died with the harness, so mark it `exited` with an
    /// unknown exit code and emit the upsert. Idempotent — already-exited rows
    /// commit nothing. The output-file linger is fine; the row now reads as
    /// stale/gone, matching harness-runtime-mechanics §4.1.
    pub fn reset_running_processes(
        &self,
        context: ActivityEventContext,
    ) -> Result<ActivityEventBatch, ActivityIngestError> {
        self.store
            .with_tx_anyhow(|tx| {
                let running = ActivityStore::list_running_processes_tx(tx, &context.session_id)?;
                let mut envelopes = Vec::new();
                let now = chrono::Utc::now().to_rfc3339();
                for existing in running {
                    let record = ActivityProcessRecord {
                        status: ProcessRunStatus::Exited,
                        exit_code: None,
                        ended_at: existing.ended_at.clone().or_else(|| Some(now.clone())),
                        updated_at: now.clone(),
                        ..existing
                    };
                    ActivityStore::upsert_process(tx, &record)?;
                    let envelope = envelope(
                        &context,
                        context.next_seq + envelopes.len() as i64,
                        SessionEvent::ActivityProcessUpserted(ActivityProcessUpsertedPayload {
                            process: record.to_contract(),
                        }),
                    );
                    ActivityStore::insert_event(tx, &event_record(&envelope)?)?;
                    envelopes.push(envelope);
                }
                Ok(ActivityEventBatch { envelopes })
            })
            .map_err(ActivityIngestError::Store)
    }

    /// Reconcile the roster from an authoritative `_anyharness/activity/list`
    /// pull on attach: upsert every listed process/subagent (Codex re-lists its
    /// child threads here). Runs in one transaction with an increasing seq so
    /// the emitted envelopes ride the session's ordered stream.
    pub fn reconcile_roster(
        &self,
        context: ActivityEventContext,
        processes: Vec<ActivityProcessWire>,
        agents: Vec<ActivitySubagentWire>,
    ) -> Result<ActivityEventBatch, ActivityIngestError> {
        self.store
            .with_tx_anyhow(|tx| {
                let mut envelopes = Vec::new();
                for wire in processes {
                    let seq = context.next_seq + envelopes.len() as i64;
                    envelopes.push(upsert_process_in_tx(tx, &context, wire, seq)?);
                }
                for wire in agents {
                    let seq = context.next_seq + envelopes.len() as i64;
                    envelopes.push(upsert_subagent_in_tx(tx, &context, wire, seq)?);
                }
                Ok(ActivityEventBatch { envelopes })
            })
            .map_err(ActivityIngestError::Store)
    }
}

fn upsert_process_in_tx(
    tx: &rusqlite::Connection,
    context: &ActivityEventContext,
    wire: ActivityProcessWire,
    seq: i64,
) -> rusqlite::Result<SessionEventEnvelope> {
    let feed_id = wire
        .feed
        .clone()
        .map(|transport| {
            bind_feed(
                tx,
                context,
                FeedOwnerKind::Process,
                &wire.id,
                FeedKind::TerminalBytes,
                transport,
            )
        })
        .transpose()?;

    let record = ActivityProcessRecord {
        session_id: context.session_id.clone(),
        workspace_id: context.workspace_id.clone(),
        process_id: wire.id.clone(),
        command: wire.command.clone(),
        cwd: wire.cwd.clone(),
        status: match wire.status {
            ActivityProcessStatusWire::Running => ProcessRunStatus::Running,
            ActivityProcessStatusWire::Exited => ProcessRunStatus::Exited,
        },
        exit_code: wire.exit_code,
        pid: wire.pid,
        started_at: rfc3339_from_epoch_ms(wire.started_at_ms)
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        ended_at: rfc3339_from_epoch_ms(wire.ended_at_ms),
        feed_id,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    ActivityStore::upsert_process(tx, &record)?;
    let envelope = envelope(
        context,
        seq,
        SessionEvent::ActivityProcessUpserted(ActivityProcessUpsertedPayload {
            process: record.to_contract(),
        }),
    );
    ActivityStore::insert_event(tx, &event_record(&envelope)?)?;
    Ok(envelope)
}

fn upsert_subagent_in_tx(
    tx: &rusqlite::Connection,
    context: &ActivityEventContext,
    wire: ActivitySubagentWire,
    seq: i64,
) -> rusqlite::Result<SessionEventEnvelope> {
    let feed_id = wire
        .feed
        .clone()
        .map(|transport| {
            bind_feed(
                tx,
                context,
                FeedOwnerKind::Subagent,
                &wire.id,
                FeedKind::Transcript,
                transport,
            )
        })
        .transpose()?;

    let record = ActivitySubagentRecord {
        session_id: context.session_id.clone(),
        workspace_id: context.workspace_id.clone(),
        subagent_id: wire.id.clone(),
        agent_type: wire.agent_type.clone(),
        description: wire.description.clone(),
        model: wire.model.clone(),
        background: wire.background,
        status: match wire.status {
            ActivitySubagentStatusWire::Running => SubagentRunStatus::Running,
            ActivitySubagentStatusWire::Completed => SubagentRunStatus::Completed,
            ActivitySubagentStatusWire::Failed => SubagentRunStatus::Failed,
        },
        summary: wire.summary.clone(),
        tokens_used: wire.tokens_used,
        tool_calls: wire.tool_calls,
        duration_seconds: wire.duration_seconds,
        feed_id,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    ActivityStore::upsert_subagent(tx, &record)?;
    let envelope = envelope(
        context,
        seq,
        SessionEvent::ActivitySubagentUpserted(ActivitySubagentUpsertedPayload {
            agent: record.to_contract(),
        }),
    );
    ActivityStore::insert_event(tx, &event_record(&envelope)?)?;
    Ok(envelope)
}

/// Resolves the stable opaque `feed_id` for one roster element, minting a
/// fresh id on first sight and reusing it (updating the transport in place)
/// on subsequent upserts — a feed with no watcher costs nothing, and the
/// contract never learns the transport.
fn bind_feed(
    tx: &rusqlite::Connection,
    context: &ActivityEventContext,
    owner_kind: FeedOwnerKind,
    owner_id: &str,
    kind: FeedKind,
    transport_wire: FeedTransportWire,
) -> rusqlite::Result<String> {
    let existing =
        ActivityStore::find_feed_binding_tx(tx, &context.session_id, owner_kind, owner_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let feed_id = existing
        .as_ref()
        .map(|binding| binding.feed_id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let record = FeedBindingRecord {
        feed_id: feed_id.clone(),
        session_id: context.session_id.clone(),
        kind,
        owner_kind,
        owner_id: owner_id.to_string(),
        transport: transport_from_wire(transport_wire),
        created_at: existing.map(|binding| binding.created_at).unwrap_or_else(|| now.clone()),
        updated_at: now,
    };
    ActivityStore::upsert_feed_binding(tx, &record)?;
    Ok(feed_id)
}

/// Convert a fork-emitted epoch-ms timestamp to the contract's RFC3339
/// string. Both harness forks emit `startedAtMs`/`endedAtMs` numbers; the
/// contract (`ActivityProcess.started_at: String`) stays RFC3339, so the
/// conversion happens here at ingest rather than rippling ms into the SDK.
fn rfc3339_from_epoch_ms(ms: Option<i64>) -> Option<String> {
    use chrono::TimeZone;
    ms.and_then(|ms| chrono::Utc.timestamp_millis_opt(ms).single())
        .map(|dt| dt.to_rfc3339())
}

fn transport_from_wire(wire: FeedTransportWire) -> FeedTransport {
    match wire {
        FeedTransportWire::TailFile { path } => FeedTransport::TailFile { path },
        FeedTransportWire::AcpChildDemux { thread_id } => {
            FeedTransport::AcpChildDemux { thread_id }
        }
        FeedTransportWire::HttpSse { url } => FeedTransport::HttpSse { url },
    }
}

fn envelope(context: &ActivityEventContext, seq: i64, event: SessionEvent) -> SessionEventEnvelope {
    SessionEventEnvelope {
        session_id: context.session_id.clone(),
        seq,
        timestamp: chrono::Utc::now().to_rfc3339(),
        turn_id: context.turn_id.clone(),
        item_id: None,
        event,
    }
}

fn event_record(envelope: &SessionEventEnvelope) -> rusqlite::Result<SessionEventRecord> {
    Ok(SessionEventRecord {
        id: 0,
        session_id: envelope.session_id.clone(),
        seq: envelope.seq,
        timestamp: envelope.timestamp.clone(),
        event_type: envelope.event.event_type().to_string(),
        turn_id: envelope.turn_id.clone(),
        item_id: envelope.item_id.clone(),
        payload_json: serde_json::to_string(&envelope.event)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?,
    })
}
