//! `LoopService`: mirror transitions and emulated-loop state for the loops
//! domain.
//!
//! Native loops (claude): the sidecar's tagged notifications are the source
//! of truth — `ingest_wire_event` upserts mirror rows keyed by the sidecar
//! loop id. Emulated loops (codex): the runtime owns the rows; the
//! `create/fire/clear` emulated ops are authoritative.
//!
//! # Partial-failure contract
//!
//! Every event-emitting method persists row + event rows in a single
//! transaction and returns EVERY committed envelope (the observer/domain-op
//! contract shared with `PlanService`).

use std::collections::HashMap;
use std::sync::Mutex;

use anyharness_contract::v1::{
    Loop, LoopClearedEvent, LoopFiredEvent, LoopScheduleKind, LoopStatus, LoopUpdatedEvent,
    SessionEvent, SessionEventEnvelope,
};
use rusqlite::Connection;

use super::model::{loop_to_contract, parse_interval_expr, LoopRecord, LoopWriteIntent};
use super::store::LoopStore;
use super::wire::LoopWire;
use crate::domains::sessions::model::SessionEventRecord;

pub const LOOP_CLEAR_REASON_MAX_FIRES: &str = "max_fires_exhausted";
pub const LOOP_CLEAR_REASON_MAX_WALL: &str = "max_wall_exceeded";
pub const LOOP_CLEAR_REASON_ONE_SHOT: &str = "one_shot_completed";

#[derive(Debug, Clone)]
pub struct LoopEventContext {
    pub session_id: String,
    pub workspace_id: String,
    pub turn_id: Option<String>,
    pub next_seq: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopIngestKind {
    Updated,
    Fired,
    Cleared,
}

/// Everything a runtime-owned (emulated) loop needs at creation.
#[derive(Debug, Clone)]
pub struct EmulatedLoopSpec {
    pub prompt: String,
    pub schedule_expr: String,
    pub recurring: bool,
    pub max_fires: Option<i64>,
    pub max_wall_secs: Option<i64>,
    pub source_kind: String,
    pub source_run_id: Option<String>,
}

pub struct LoopService {
    store: LoopStore,
    /// Pending runtime write intents keyed by session id; matched to the
    /// mirrored row by prompt on `loop_updated` ingest.
    write_intents: Mutex<HashMap<String, Vec<LoopWriteIntent>>>,
}

const DEFAULT_WORKSPACE_LOOP_LIMIT: usize = 200;

impl LoopService {
    pub fn new(store: LoopStore) -> Self {
        Self {
            store,
            write_intents: Mutex::new(HashMap::new()),
        }
    }

    pub fn store(&self) -> &LoopStore {
        &self.store
    }

    pub fn get(&self, loop_id: &str) -> anyhow::Result<Option<LoopRecord>> {
        self.store.find_by_id(loop_id)
    }

    pub fn list_active_by_session(&self, session_id: &str) -> anyhow::Result<Vec<LoopRecord>> {
        self.store.list_active_by_session(session_id)
    }

    pub fn list_by_workspace(&self, workspace_id: &str) -> anyhow::Result<Vec<LoopRecord>> {
        self.store
            .list_by_workspace(workspace_id, DEFAULT_WORKSPACE_LOOP_LIMIT)
    }

    pub fn record_write_intent(&self, session_id: &str, intent: LoopWriteIntent) {
        self.write_intents
            .lock()
            .expect("loop write intents lock poisoned")
            .entry(session_id.to_string())
            .or_default()
            .push(intent);
    }

    fn take_write_intent_for_prompt(
        &self,
        session_id: &str,
        prompt: Option<&str>,
    ) -> Option<LoopWriteIntent> {
        let mut intents = self
            .write_intents
            .lock()
            .expect("loop write intents lock poisoned");
        let session_intents = intents.get_mut(session_id)?;
        let index = match prompt {
            Some(prompt) => session_intents
                .iter()
                .position(|intent| intent.prompt == prompt)?,
            None => return None,
        };
        Some(session_intents.remove(index))
    }

    /// Record the guard/user clear reason on a native row ahead of the
    /// sidecar round-trip so the eventual `loop_cleared` ingest carries it.
    /// No event is emitted here.
    pub fn stage_cleared_reason(&self, loop_id: &str, reason: &str) -> anyhow::Result<()> {
        let loop_id = loop_id.to_string();
        let reason = reason.to_string();
        self.store.with_tx_anyhow(move |tx| {
            if let Some(mut record) = LoopStore::find_by_id_tx(tx, &loop_id)? {
                record.cleared_reason = Some(reason);
                record.updated_at = chrono::Utc::now().to_rfc3339();
                LoopStore::update_loop(tx, &record)?;
            }
            Ok(())
        })
    }

    // ------------------------------------------------------------------
    // Native mirror ingest (source of truth: tagged sidecar notifications)
    // ------------------------------------------------------------------

    pub fn ingest_wire_event(
        &self,
        ctx: &LoopEventContext,
        kind: LoopIngestKind,
        wire: Option<&serde_json::Value>,
        loop_id_hint: Option<&str>,
    ) -> anyhow::Result<Vec<SessionEventEnvelope>> {
        let parsed = wire.and_then(LoopWire::from_value);
        let native_loop_id = parsed
            .as_ref()
            .and_then(|wire| wire.loop_id.as_deref())
            .or(loop_id_hint)
            .map(ToOwned::to_owned);
        match kind {
            LoopIngestKind::Updated => {
                let Some(parsed) = parsed else {
                    tracing::warn!(session_id = %ctx.session_id, "loop_updated missing loop payload; skipping");
                    return Ok(Vec::new());
                };
                self.apply_wire_upsert(ctx, &parsed, wire.expect("wire present when parsed"))
            }
            LoopIngestKind::Fired => self.apply_wire_fire(ctx, parsed.as_ref(), native_loop_id),
            LoopIngestKind::Cleared => self.apply_wire_clear(ctx, native_loop_id),
        }
    }

    fn apply_wire_upsert(
        &self,
        ctx: &LoopEventContext,
        wire: &LoopWire,
        raw_wire: &serde_json::Value,
    ) -> anyhow::Result<Vec<SessionEventEnvelope>> {
        let Some(native_loop_id) = wire.loop_id.clone() else {
            tracing::warn!(session_id = %ctx.session_id, "loop_updated wire missing loopId; skipping");
            return Ok(Vec::new());
        };
        let intent = self.take_write_intent_for_prompt(&ctx.session_id, wire.prompt.as_deref());
        let now = chrono::Utc::now().to_rfc3339();
        let native_state_json = raw_wire.to_string();
        let status = wire.normalized_status();

        self.store.with_tx_anyhow(move |tx| {
            let existing =
                LoopStore::find_by_native_loop_id_tx(tx, &ctx.session_id, &native_loop_id)?;
            let record = match existing {
                Some(mut record) => {
                    if let Some(prompt) = wire.prompt.clone() {
                        record.prompt = prompt;
                    }
                    if let Some(expr) = wire.schedule_expr() {
                        record.schedule_kind = wire.schedule_kind();
                        record.schedule_expr = expr.to_string();
                    }
                    if let Some(recurring) = wire.recurring {
                        record.recurring = recurring;
                    }
                    record.status = status;
                    if let Some(fire_count) = wire.fire_count {
                        record.fire_count = fire_count;
                    }
                    if let Some(last_fired) = wire.last_fired_at_rfc3339() {
                        record.last_fired_at = Some(last_fired);
                    }
                    if let Some(intent) = &intent {
                        record.source_kind = intent.source_kind.clone();
                        record.max_fires = intent.max_fires;
                        record.max_wall_secs = intent.max_wall_secs;
                    }
                    record.native_state_json = native_state_json.clone();
                    record.revision += 1;
                    record.updated_at = now.clone();
                    LoopStore::update_loop(tx, &record)?;
                    record
                }
                None => {
                    let intent = intent.clone().unwrap_or(LoopWriteIntent {
                        source_kind: "agent".to_string(),
                        ..LoopWriteIntent::default()
                    });
                    let record = LoopRecord {
                        id: uuid::Uuid::new_v4().to_string(),
                        workspace_id: ctx.workspace_id.clone(),
                        session_id: ctx.session_id.clone(),
                        prompt: wire.prompt.clone().unwrap_or_default(),
                        schedule_kind: wire.schedule_kind(),
                        schedule_expr: wire.schedule_expr().unwrap_or_default().to_string(),
                        recurring: wire.recurring.unwrap_or(true),
                        status,
                        native: true,
                        native_loop_id: Some(native_loop_id.clone()),
                        last_fired_at: wire.last_fired_at_rfc3339(),
                        next_fire_at: None,
                        fire_count: wire.fire_count.unwrap_or(0),
                        max_fires: intent.max_fires,
                        max_wall_secs: intent.max_wall_secs,
                        source_kind: intent.source_kind,
                        cleared_reason: None,
                        native_state_json: native_state_json.clone(),
                        revision: 1,
                        created_at: now.clone(),
                        updated_at: now.clone(),
                    };
                    LoopStore::insert_loop(tx, &record)?;
                    record
                }
            };
            let envelope = envelope(
                ctx,
                ctx.next_seq,
                SessionEvent::LoopUpdated(LoopUpdatedEvent {
                    loop_: loop_to_contract(&record),
                }),
            );
            LoopStore::insert_event(tx, &event_record(&envelope)?)?;
            Ok(vec![envelope])
        })
    }

    fn apply_wire_fire(
        &self,
        ctx: &LoopEventContext,
        wire: Option<&LoopWire>,
        native_loop_id: Option<String>,
    ) -> anyhow::Result<Vec<SessionEventEnvelope>> {
        let Some(native_loop_id) = native_loop_id else {
            tracing::warn!(session_id = %ctx.session_id, "loop_fired missing loopId; skipping");
            return Ok(Vec::new());
        };
        let now = chrono::Utc::now().to_rfc3339();
        let fired_at = wire
            .and_then(LoopWire::last_fired_at_rfc3339)
            .unwrap_or_else(|| now.clone());
        let wire_fire_count = wire.and_then(|wire| wire.fire_count);

        self.store.with_tx_anyhow(move |tx| {
            let Some(mut record) =
                LoopStore::find_by_native_loop_id_tx(tx, &ctx.session_id, &native_loop_id)?
            else {
                tracing::debug!(
                    session_id = %ctx.session_id,
                    native_loop_id = %native_loop_id,
                    "loop_fired for unknown loop; no mirror row to update"
                );
                return Ok(Vec::new());
            };
            record.fire_count = wire_fire_count.unwrap_or(record.fire_count + 1);
            record.last_fired_at = Some(fired_at.clone());
            record.revision += 1;
            record.updated_at = now.clone();
            LoopStore::update_loop(tx, &record)?;

            let envelope = envelope(
                ctx,
                ctx.next_seq,
                SessionEvent::LoopFired(LoopFiredEvent {
                    loop_: loop_to_contract(&record),
                    fired_at,
                    turn_id: ctx.turn_id.clone(),
                }),
            );
            LoopStore::insert_event(tx, &event_record(&envelope)?)?;
            Ok(vec![envelope])
        })
    }

    fn apply_wire_clear(
        &self,
        ctx: &LoopEventContext,
        native_loop_id: Option<String>,
    ) -> anyhow::Result<Vec<SessionEventEnvelope>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.store.with_tx_anyhow(move |tx| {
            let targets: Vec<LoopRecord> = match &native_loop_id {
                Some(native_loop_id) => {
                    LoopStore::find_by_native_loop_id_tx(tx, &ctx.session_id, native_loop_id)?
                        .into_iter()
                        .filter(|record| record.status != LoopStatus::Cleared)
                        .collect()
                }
                None => LoopStore::list_active_by_session_tx(tx, &ctx.session_id)?
                    .into_iter()
                    .filter(|record| record.native)
                    .collect(),
            };
            let mut seq = ctx.next_seq;
            let mut envelopes = Vec::new();
            for mut record in targets {
                record.status = LoopStatus::Cleared;
                record.revision += 1;
                record.updated_at = now.clone();
                LoopStore::update_loop(tx, &record)?;
                let envelope = envelope(
                    ctx,
                    seq,
                    SessionEvent::LoopCleared(LoopClearedEvent {
                        loop_: loop_to_contract(&record),
                    }),
                );
                LoopStore::insert_event(tx, &event_record(&envelope)?)?;
                seq += 1;
                envelopes.push(envelope);
            }
            Ok(envelopes)
        })
    }

    // ------------------------------------------------------------------
    // Emulated loops (runtime-owned; codex)
    // ------------------------------------------------------------------

    pub fn create_emulated_with_context(
        &self,
        ctx: &LoopEventContext,
        spec: &EmulatedLoopSpec,
    ) -> anyhow::Result<(LoopRecord, Vec<SessionEventEnvelope>)> {
        self.store
            .with_tx_anyhow(|tx| create_emulated_tx(tx, ctx, spec))
    }

    /// Offline variant: seq assigned from the database. Callers must have
    /// confirmed no live actor owns event sequencing for this session.
    pub fn create_emulated_offline(
        &self,
        session_id: &str,
        workspace_id: &str,
        spec: &EmulatedLoopSpec,
    ) -> anyhow::Result<(LoopRecord, Vec<SessionEventEnvelope>)> {
        self.store.with_tx_anyhow(|tx| {
            let ctx = LoopEventContext {
                session_id: session_id.to_string(),
                workspace_id: workspace_id.to_string(),
                turn_id: None,
                next_seq: LoopStore::next_event_seq(tx, session_id)?,
            };
            create_emulated_tx(tx, &ctx, spec)
        })
    }

    /// Record one emulated fire: bumps counters, re-computes the next fire,
    /// and clears the loop when caps are exhausted or it was one-shot.
    /// Returns the updated row and every committed envelope
    /// (`loop_fired` [+ `loop_cleared`]).
    pub fn record_emulated_fire_with_context(
        &self,
        ctx: &LoopEventContext,
        loop_id: &str,
    ) -> anyhow::Result<(Option<LoopRecord>, Vec<SessionEventEnvelope>)> {
        let now = chrono::Utc::now();
        self.store.with_tx_anyhow(|tx| {
            let Some(mut record) = LoopStore::find_by_id_tx(tx, loop_id)? else {
                return Ok((None, Vec::new()));
            };
            if record.status != LoopStatus::Active || record.native {
                return Ok((Some(record), Vec::new()));
            }
            let now_str = now.to_rfc3339();
            record.fire_count += 1;
            record.last_fired_at = Some(now_str.clone());
            record.next_fire_at = if record.recurring {
                parse_interval_expr(&record.schedule_expr)
                    .map(|interval| (now + interval).to_rfc3339())
            } else {
                None
            };

            let cleared_reason = if !record.recurring {
                Some(LOOP_CLEAR_REASON_ONE_SHOT)
            } else if record
                .max_fires
                .is_some_and(|max_fires| record.fire_count >= max_fires)
            {
                Some(LOOP_CLEAR_REASON_MAX_FIRES)
            } else if wall_exceeded(&record, now) {
                Some(LOOP_CLEAR_REASON_MAX_WALL)
            } else {
                None
            };
            if let Some(reason) = cleared_reason {
                record.status = LoopStatus::Cleared;
                record.cleared_reason = Some(reason.to_string());
                record.next_fire_at = None;
            }
            record.revision += 1;
            record.updated_at = now_str.clone();
            LoopStore::update_loop(tx, &record)?;

            let mut seq = ctx.next_seq;
            let mut envelopes = Vec::new();
            let fired = envelope(
                ctx,
                seq,
                SessionEvent::LoopFired(LoopFiredEvent {
                    loop_: loop_to_contract(&record),
                    fired_at: now_str,
                    turn_id: ctx.turn_id.clone(),
                }),
            );
            LoopStore::insert_event(tx, &event_record(&fired)?)?;
            seq += 1;
            envelopes.push(fired);
            if cleared_reason.is_some() {
                let cleared = envelope(
                    ctx,
                    seq,
                    SessionEvent::LoopCleared(LoopClearedEvent {
                        loop_: loop_to_contract(&record),
                    }),
                );
                LoopStore::insert_event(tx, &event_record(&cleared)?)?;
                envelopes.push(cleared);
            }
            Ok((Some(record), envelopes))
        })
    }

    /// Clear emulated loops (one by id, or every active emulated loop for
    /// the session). Returns cleared rows + committed envelopes.
    pub fn clear_emulated_with_context(
        &self,
        ctx: &LoopEventContext,
        loop_id: Option<&str>,
        reason: Option<&str>,
    ) -> anyhow::Result<(Vec<LoopRecord>, Vec<SessionEventEnvelope>)> {
        self.store
            .with_tx_anyhow(|tx| clear_emulated_tx(tx, ctx, loop_id, reason))
    }

    /// Offline variant of [`Self::clear_emulated_with_context`].
    pub fn clear_emulated_offline(
        &self,
        session_id: &str,
        workspace_id: &str,
        loop_id: Option<&str>,
        reason: Option<&str>,
    ) -> anyhow::Result<(Vec<LoopRecord>, Vec<SessionEventEnvelope>)> {
        self.store.with_tx_anyhow(|tx| {
            let ctx = LoopEventContext {
                session_id: session_id.to_string(),
                workspace_id: workspace_id.to_string(),
                turn_id: None,
                next_seq: LoopStore::next_event_seq(tx, session_id)?,
            };
            clear_emulated_tx(tx, &ctx, loop_id, reason)
        })
    }
}

fn create_emulated_tx(
    tx: &Connection,
    ctx: &LoopEventContext,
    spec: &EmulatedLoopSpec,
) -> anyhow::Result<(LoopRecord, Vec<SessionEventEnvelope>)> {
    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();
    let interval = parse_interval_expr(&spec.schedule_expr)
        .ok_or_else(|| anyhow::anyhow!("invalid interval expression: {}", spec.schedule_expr))?;
    let record = LoopRecord {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: ctx.workspace_id.clone(),
        session_id: ctx.session_id.clone(),
        prompt: spec.prompt.clone(),
        schedule_kind: LoopScheduleKind::Interval,
        schedule_expr: spec.schedule_expr.clone(),
        recurring: spec.recurring,
        status: LoopStatus::Active,
        native: false,
        native_loop_id: None,
        last_fired_at: None,
        next_fire_at: Some((now + interval).to_rfc3339()),
        fire_count: 0,
        max_fires: spec.max_fires,
        max_wall_secs: spec.max_wall_secs,
        source_kind: spec.source_kind.clone(),
        cleared_reason: None,
        native_state_json: String::new(),
        revision: 1,
        created_at: now_str.clone(),
        updated_at: now_str,
    };
    LoopStore::insert_loop(tx, &record)?;
    let envelope = envelope(
        ctx,
        ctx.next_seq,
        SessionEvent::LoopUpdated(LoopUpdatedEvent {
            loop_: loop_to_contract(&record),
        }),
    );
    LoopStore::insert_event(tx, &event_record(&envelope)?)?;
    Ok((record, vec![envelope]))
}

fn clear_emulated_tx(
    tx: &Connection,
    ctx: &LoopEventContext,
    loop_id: Option<&str>,
    reason: Option<&str>,
) -> anyhow::Result<(Vec<LoopRecord>, Vec<SessionEventEnvelope>)> {
    let now = chrono::Utc::now().to_rfc3339();
    let targets: Vec<LoopRecord> = match loop_id {
        Some(loop_id) => LoopStore::find_by_id_tx(tx, loop_id)?
            .into_iter()
            .filter(|record| {
                record.session_id == ctx.session_id
                    && !record.native
                    && record.status != LoopStatus::Cleared
            })
            .collect(),
        None => LoopStore::list_active_by_session_tx(tx, &ctx.session_id)?
            .into_iter()
            .filter(|record| !record.native)
            .collect(),
    };
    let mut seq = ctx.next_seq;
    let mut envelopes = Vec::new();
    let mut cleared = Vec::new();
    for mut record in targets {
        record.status = LoopStatus::Cleared;
        record.cleared_reason = reason.map(ToOwned::to_owned);
        record.next_fire_at = None;
        record.revision += 1;
        record.updated_at = now.clone();
        LoopStore::update_loop(tx, &record)?;
        let envelope = envelope(
            ctx,
            seq,
            SessionEvent::LoopCleared(LoopClearedEvent {
                loop_: loop_to_contract(&record),
            }),
        );
        LoopStore::insert_event(tx, &event_record(&envelope)?)?;
        seq += 1;
        envelopes.push(envelope);
        cleared.push(record);
    }
    Ok((cleared, envelopes))
}

fn wall_exceeded(record: &LoopRecord, now: chrono::DateTime<chrono::Utc>) -> bool {
    let Some(max_wall_secs) = record.max_wall_secs else {
        return false;
    };
    let Ok(created_at) = chrono::DateTime::parse_from_rfc3339(&record.created_at) else {
        return false;
    };
    (now - created_at.with_timezone(&chrono::Utc)).num_seconds() >= max_wall_secs
}

pub fn loop_records_to_contract(records: &[LoopRecord]) -> Vec<Loop> {
    records.iter().map(loop_to_contract).collect()
}

fn envelope(ctx: &LoopEventContext, seq: i64, event: SessionEvent) -> SessionEventEnvelope {
    SessionEventEnvelope {
        session_id: ctx.session_id.clone(),
        seq,
        timestamp: chrono::Utc::now().to_rfc3339(),
        turn_id: ctx.turn_id.clone(),
        item_id: None,
        event,
    }
}

fn event_record(envelope: &SessionEventEnvelope) -> anyhow::Result<SessionEventRecord> {
    Ok(SessionEventRecord {
        id: 0,
        session_id: envelope.session_id.clone(),
        seq: envelope.seq,
        timestamp: envelope.timestamp.clone(),
        event_type: envelope.event.event_type().to_string(),
        turn_id: envelope.turn_id.clone(),
        item_id: envelope.item_id.clone(),
        payload_json: serde_json::to_string(&envelope.event)?,
    })
}
