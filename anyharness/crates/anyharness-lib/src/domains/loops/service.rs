use std::collections::HashMap;

use anyharness_contract::v1::{
    LoopFiredPayload, LoopRemovedPayload, LoopStatus, LoopUpsertedPayload, SessionEvent,
    SessionEventEnvelope,
};

use super::model::LoopRecord;
use super::store::LoopStore;
use super::wire::LoopWire;
use crate::domains::sessions::model::SessionEventRecord;

pub const MAX_LOOP_PROMPT_BYTES: usize = 16 * 1024;

/// The tagged-chunk kinds the sidecars (and, on Codex, the runtime-emulated
/// `LoopSchedulerExtension`) emit — `loop_upserted | loop_removed |
/// loop_fired` (session-activity-architecture up-path vocabulary).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopNativeEventKind {
    Upserted,
    Removed,
    Fired,
}

#[derive(Debug, Clone)]
pub struct LoopEventContext {
    pub workspace_id: String,
    pub session_id: String,
    pub source_agent_kind: String,
    pub turn_id: Option<String>,
    pub next_seq: i64,
}

#[derive(Debug, Clone)]
pub struct LoopEventBatch {
    pub r#loop: Option<LoopRecord>,
    pub envelopes: Vec<SessionEventEnvelope>,
}

impl LoopEventBatch {
    fn unchanged(r#loop: Option<LoopRecord>) -> Self {
        Self {
            r#loop,
            envelopes: Vec::new(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LoopIngestError {
    #[error("loop notification payload is missing its loop")]
    MissingLoopPayload,
    #[error("loop_removed notification is missing its loopId")]
    MissingLoopId,
    #[error("loop prompt exceeds {MAX_LOOP_PROMPT_BYTES} bytes")]
    PromptTooLarge,
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

/// Mirror-keeping over the loops table. Unlike
/// [`crate::domains::goals::service::GoalService`] there is no single-head
/// lifecycle: each notification names its own `loop_id`, so ingestion is a
/// plain keyed upsert. Records transition ONLY through the native-event
/// ingest path here; the write path (`_anyharness/loop/set|clear`) lands
/// with the loop runtime PR.
#[derive(Clone)]
pub struct LoopService {
    store: LoopStore,
}

impl LoopService {
    pub fn new(store: LoopStore) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &LoopStore {
        &self.store
    }

    pub fn current_loops(&self, session_id: &str) -> anyhow::Result<Vec<LoopRecord>> {
        self.store.list_active(session_id)
    }

    pub fn current_loops_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<HashMap<String, Vec<LoopRecord>>> {
        self.store.list_active_for_sessions(session_ids)
    }

    /// Ingests one sidecar loop notification: upserts the mirror row and
    /// persists the matching contract event row in a single transaction,
    /// returning every committed envelope (the observer partial-failure
    /// contract). Idempotent: a notification that changes nothing commits
    /// nothing and returns no envelopes.
    pub fn ingest_native_event(
        &self,
        context: LoopEventContext,
        kind: LoopNativeEventKind,
        wire: Option<LoopWire>,
        loop_id: Option<String>,
    ) -> Result<LoopEventBatch, LoopIngestError> {
        if let Some(wire) = wire.as_ref() {
            if wire.prompt.len() > MAX_LOOP_PROMPT_BYTES {
                return Err(LoopIngestError::PromptTooLarge);
            }
        }
        match kind {
            LoopNativeEventKind::Upserted => {
                let wire = wire.ok_or(LoopIngestError::MissingLoopPayload)?;
                self.apply_upsert(context, wire, false)
                    .map_err(LoopIngestError::Store)
            }
            LoopNativeEventKind::Fired => {
                let wire = wire.ok_or(LoopIngestError::MissingLoopPayload)?;
                self.apply_upsert(context, wire, true)
                    .map_err(LoopIngestError::Store)
            }
            LoopNativeEventKind::Removed => {
                let loop_id = loop_id
                    .or_else(|| wire.map(|wire| wire.loop_id))
                    .ok_or(LoopIngestError::MissingLoopId)?;
                self.apply_removed(context, loop_id)
                    .map_err(LoopIngestError::Store)
            }
        }
    }

    fn apply_upsert(
        &self,
        context: LoopEventContext,
        wire: LoopWire,
        fired: bool,
    ) -> anyhow::Result<LoopEventBatch> {
        self.store.with_tx_anyhow(|tx| {
            let now = chrono::Utc::now().to_rfc3339();
            let existing = LoopStore::find_one_tx(tx, &context.session_id, &wire.loop_id)?;
            let native_state_json = Some(serde_json::to_string(&wire)?);
            let next = LoopRecord {
                session_id: context.session_id.clone(),
                workspace_id: context.workspace_id.clone(),
                loop_id: wire.loop_id.clone(),
                prompt: wire.prompt.clone(),
                schedule_kind: wire.schedule.kind.to_contract(),
                schedule_expr: wire.schedule.expr.clone(),
                recurring: wire.recurring,
                status: wire.status.to_contract(),
                native: wire.native,
                last_fired_at_ms: wire.last_fired_at_ms,
                fire_count: wire.fire_count,
                native_state_json,
                created_at: existing
                    .as_ref()
                    .map(|existing| existing.created_at.clone())
                    .unwrap_or_else(|| now.clone()),
                updated_at_ms: wire.updated_at_ms,
            };

            if !fired {
                if let Some(existing) = existing.as_ref() {
                    if loop_content_unchanged(existing, &next) {
                        return Ok(LoopEventBatch::unchanged(Some(existing.clone())));
                    }
                }
            }

            LoopStore::upsert_loop(tx, &next)?;

            let event = if fired {
                SessionEvent::LoopFired(LoopFiredPayload {
                    r#loop: next.to_contract(),
                    fired_at_ms: next.last_fired_at_ms.unwrap_or(next.updated_at_ms),
                    turn_id: context.turn_id.clone(),
                })
            } else {
                SessionEvent::LoopUpserted(LoopUpsertedPayload {
                    r#loop: next.to_contract(),
                })
            };
            let envelope = envelope(&context, context.next_seq, event);
            LoopStore::insert_event(tx, &event_record(&envelope)?)?;
            Ok(LoopEventBatch {
                r#loop: Some(next),
                envelopes: vec![envelope],
            })
        })
    }

    fn apply_removed(
        &self,
        context: LoopEventContext,
        loop_id: String,
    ) -> anyhow::Result<LoopEventBatch> {
        self.store.with_tx_anyhow(|tx| {
            let Some(existing) = LoopStore::find_one_tx(tx, &context.session_id, &loop_id)? else {
                return Ok(LoopEventBatch::unchanged(None));
            };
            if existing.status == LoopStatus::Cleared {
                return Ok(LoopEventBatch::unchanged(Some(existing)));
            }
            let removed = LoopRecord {
                status: LoopStatus::Cleared,
                updated_at_ms: now_ms(),
                ..existing
            };
            LoopStore::upsert_loop(tx, &removed)?;
            let envelope = envelope(
                &context,
                context.next_seq,
                SessionEvent::LoopRemoved(LoopRemovedPayload {
                    loop_id: removed.loop_id.clone(),
                }),
            );
            LoopStore::insert_event(tx, &event_record(&envelope)?)?;
            Ok(LoopEventBatch {
                r#loop: Some(removed),
                envelopes: vec![envelope],
            })
        })
    }
}

/// Content equality for idempotent ingest: everything the wire can move,
/// excluding bookkeeping (`created_at`).
fn loop_content_unchanged(existing: &LoopRecord, next: &LoopRecord) -> bool {
    existing.prompt == next.prompt
        && existing.schedule_kind == next.schedule_kind
        && existing.schedule_expr == next.schedule_expr
        && existing.recurring == next.recurring
        && existing.status == next.status
        && existing.native == next.native
        && existing.last_fired_at_ms == next.last_fired_at_ms
        && existing.fire_count == next.fire_count
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn envelope(context: &LoopEventContext, seq: i64, event: SessionEvent) -> SessionEventEnvelope {
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
