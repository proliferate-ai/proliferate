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

/// Per-session cap on active runtime-emulated loops. Each arm mints a fresh
/// `loop_id` and an always-on scheduler timer, so without a cap N unbounded
/// arms accumulate N scheduler entries that each queue a prompt when the
/// session next goes idle. Only new arms count against it — editing an
/// existing loop by id does not.
pub const MAX_ACTIVE_EMULATED_LOOPS: usize = 20;

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
    #[error("session already holds the maximum number of active loops")]
    TooManyActiveLoops,
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
                // Native crons own their own cadence — the emulated scheduler
                // fields never apply to them.
                max_fires: existing.as_ref().and_then(|existing| existing.max_fires),
                next_fire_at_ms: existing.as_ref().and_then(|existing| existing.next_fire_at_ms),
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
                next_fire_at_ms: None,
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

/// The arm/edit payload for a runtime-emulated loop (`native = false`).
/// `next_fire_at_ms` is precomputed by the runtime (it owns "now" and
/// schedule validation) so the service stays IO-only over sqlite.
#[derive(Debug, Clone)]
pub struct EmulatedLoopSpec {
    pub loop_id: String,
    pub prompt: String,
    pub schedule: anyharness_contract::v1::LoopSchedule,
    pub recurring: bool,
    pub max_fires: Option<i64>,
    pub next_fire_at_ms: i64,
}

/// Outcome of recording one emulated fire.
#[derive(Debug, Clone)]
pub struct EmulatedFireOutcome {
    pub batch: LoopEventBatch,
    /// Whether the loop remains armed after this fire (false once a
    /// non-recurring loop fires or a capped loop reaches `max_fires`).
    pub still_armed: bool,
    pub next_fire_at_ms: Option<i64>,
}

impl LoopService {
    /// Active emulated (`native = false`) loops for a session — the set the
    /// [`super::scheduler::LoopScheduler`] re-arms on attach.
    pub fn active_emulated_loops(&self, session_id: &str) -> anyhow::Result<Vec<LoopRecord>> {
        self.store.list_active_emulated(session_id)
    }

    /// Arm-or-edit a runtime-emulated loop. Creates the mirror row
    /// (`native = false`) or edits an existing one in place, persists the
    /// `LoopUpserted` event, and returns the committed envelopes. Idempotent:
    /// an edit that changes nothing commits nothing.
    pub fn arm_emulated_loop(
        &self,
        context: LoopEventContext,
        spec: EmulatedLoopSpec,
    ) -> Result<LoopEventBatch, LoopIngestError> {
        if spec.prompt.len() > MAX_LOOP_PROMPT_BYTES {
            return Err(LoopIngestError::PromptTooLarge);
        }
        // Cap active emulated loops per session. Only a NEW loop counts — an
        // edit reuses an existing loop_id and must always be allowed through.
        if self.store.find_one(&context.session_id, &spec.loop_id)?.is_none()
            && self.store.list_active_emulated(&context.session_id)?.len()
                >= MAX_ACTIVE_EMULATED_LOOPS
        {
            return Err(LoopIngestError::TooManyActiveLoops);
        }
        self.store
            .with_tx_anyhow(|tx| {
                let now = now_ms();
                let existing = LoopStore::find_one_tx(tx, &context.session_id, &spec.loop_id)?;
                let next = LoopRecord {
                    session_id: context.session_id.clone(),
                    workspace_id: context.workspace_id.clone(),
                    loop_id: spec.loop_id.clone(),
                    prompt: spec.prompt.clone(),
                    schedule_kind: spec.schedule.kind,
                    schedule_expr: spec.schedule.expr.clone(),
                    recurring: spec.recurring,
                    status: LoopStatus::Active,
                    native: false,
                    last_fired_at_ms: existing.as_ref().and_then(|e| e.last_fired_at_ms),
                    fire_count: existing.as_ref().map(|e| e.fire_count).unwrap_or(0),
                    native_state_json: None,
                    max_fires: spec.max_fires,
                    next_fire_at_ms: Some(spec.next_fire_at_ms),
                    created_at: existing
                        .as_ref()
                        .map(|e| e.created_at.clone())
                        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                    updated_at_ms: now,
                };
                if let Some(existing) = existing.as_ref() {
                    if loop_content_unchanged(existing, &next)
                        && existing.next_fire_at_ms == next.next_fire_at_ms
                        && existing.max_fires == next.max_fires
                    {
                        return Ok(LoopEventBatch::unchanged(Some(existing.clone())));
                    }
                }
                LoopStore::upsert_loop(tx, &next)?;
                let envelope = envelope(
                    &context,
                    context.next_seq,
                    SessionEvent::LoopUpserted(LoopUpsertedPayload {
                        r#loop: next.to_contract(),
                    }),
                );
                LoopStore::insert_event(tx, &event_record(&envelope)?)?;
                Ok(LoopEventBatch {
                    r#loop: Some(next),
                    envelopes: vec![envelope],
                })
            })
            .map_err(LoopIngestError::Store)
    }

    /// Clear one loop by id (mark `cleared`, emit `LoopRemoved`). Shared by the
    /// emulated clear path and the native-reconcile "missing means gone" rule.
    /// Idempotent: an already-cleared or unknown loop commits nothing.
    pub fn clear_loop(
        &self,
        context: LoopEventContext,
        loop_id: String,
    ) -> Result<LoopEventBatch, LoopIngestError> {
        self.apply_removed(context, loop_id)
            .map_err(LoopIngestError::Store)
    }

    /// Clear every active loop for the session, returning the count and all
    /// committed envelopes across the batch.
    pub fn clear_all_loops(
        &self,
        context: LoopEventContext,
    ) -> Result<(u32, Vec<SessionEventEnvelope>), LoopIngestError> {
        let active = self.store.list_active(&context.session_id)?;
        let mut cleared = 0u32;
        let mut envelopes = Vec::new();
        let mut seq = context.next_seq;
        for record in active {
            let mut ctx = context.clone();
            ctx.next_seq = seq;
            let batch = self
                .apply_removed(ctx, record.loop_id)
                .map_err(LoopIngestError::Store)?;
            if !batch.envelopes.is_empty() {
                cleared += 1;
                seq += batch.envelopes.len() as i64;
                envelopes.extend(batch.envelopes);
            }
        }
        Ok((cleared, envelopes))
    }

    /// Record one emulated fire: bump `fire_count` / `last_fired_at`, advance
    /// `next_fire_at` (recomputed from the schedule), and honor `max_fires`
    /// (clearing the loop once the cap is hit or a non-recurring loop fires).
    /// Emits `LoopFired` plus, when the fire retires the loop, `LoopRemoved`.
    pub fn record_emulated_fire(
        &self,
        context: LoopEventContext,
        loop_id: String,
        fired_at_ms: i64,
    ) -> Result<Option<EmulatedFireOutcome>, LoopIngestError> {
        self.store
            .with_tx_anyhow(|tx| {
                let Some(existing) = LoopStore::find_one_tx(tx, &context.session_id, &loop_id)?
                else {
                    return Ok(None);
                };
                if existing.status != LoopStatus::Active || existing.native {
                    return Ok(None);
                }
                let fire_count = existing.fire_count + 1;
                let capped = existing
                    .max_fires
                    .map(|cap| fire_count >= cap)
                    .unwrap_or(false);
                let retire = capped || !existing.recurring;

                let next_fire_at_ms = if retire {
                    None
                } else {
                    super::schedule::next_fire_at_ms(
                        &existing.to_contract().schedule,
                        fired_at_ms,
                    )
                    .ok()
                };
                let status = if retire {
                    LoopStatus::Cleared
                } else {
                    LoopStatus::Active
                };
                let updated = LoopRecord {
                    status,
                    last_fired_at_ms: Some(fired_at_ms),
                    fire_count,
                    next_fire_at_ms,
                    updated_at_ms: now_ms(),
                    ..existing
                };
                LoopStore::upsert_loop(tx, &updated)?;

                let mut envelopes = Vec::new();
                let fired_event = envelope(
                    &context,
                    context.next_seq,
                    SessionEvent::LoopFired(LoopFiredPayload {
                        r#loop: updated.to_contract(),
                        fired_at_ms,
                        turn_id: context.turn_id.clone(),
                    }),
                );
                LoopStore::insert_event(tx, &event_record(&fired_event)?)?;
                envelopes.push(fired_event);

                if retire {
                    let removed_event = envelope(
                        &context,
                        context.next_seq + 1,
                        SessionEvent::LoopRemoved(LoopRemovedPayload {
                            loop_id: updated.loop_id.clone(),
                        }),
                    );
                    LoopStore::insert_event(tx, &event_record(&removed_event)?)?;
                    envelopes.push(removed_event);
                }

                Ok(Some(EmulatedFireOutcome {
                    batch: LoopEventBatch {
                        r#loop: Some(updated),
                        envelopes,
                    },
                    still_armed: !retire,
                    next_fire_at_ms,
                }))
            })
            .map_err(LoopIngestError::Store)
    }

    /// Reconcile the native loop mirror against an authoritative `loop/list`
    /// pull on attach: upsert every listed loop and mark any active native
    /// mirror row the harness no longer reports as `cleared`. Emulated
    /// (`native = false`) rows are never touched by native reconcile.
    pub fn reconcile_native_loops(
        &self,
        context: LoopEventContext,
        wires: Vec<LoopWire>,
    ) -> Result<Vec<SessionEventEnvelope>, LoopIngestError> {
        for wire in wires.iter() {
            if wire.prompt.len() > MAX_LOOP_PROMPT_BYTES {
                return Err(LoopIngestError::PromptTooLarge);
            }
        }
        let mut envelopes = Vec::new();
        let mut seq = context.next_seq;
        let listed_ids: std::collections::HashSet<String> =
            wires.iter().map(|wire| wire.loop_id.clone()).collect();

        for wire in wires {
            let mut ctx = context.clone();
            ctx.next_seq = seq;
            let batch = self.apply_upsert(ctx, wire, false).map_err(LoopIngestError::Store)?;
            seq += batch.envelopes.len() as i64;
            envelopes.extend(batch.envelopes);
        }

        // Any active native loop the harness no longer lists is gone.
        let active = self.store.list_active(&context.session_id)?;
        for record in active {
            if !record.native || listed_ids.contains(&record.loop_id) {
                continue;
            }
            let mut ctx = context.clone();
            ctx.next_seq = seq;
            let batch = self
                .apply_removed(ctx, record.loop_id)
                .map_err(LoopIngestError::Store)?;
            seq += batch.envelopes.len() as i64;
            envelopes.extend(batch.envelopes);
        }
        Ok(envelopes)
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
