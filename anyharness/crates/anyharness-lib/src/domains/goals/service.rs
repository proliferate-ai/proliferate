use anyharness_contract::v1::{
    Goal, GoalClearedPayload, GoalMetPayload, GoalStatus, GoalUpdatedPayload, SessionEvent,
    SessionEventEnvelope,
};

use super::model::{GoalPendingOp, GoalRecord};
use super::store::GoalStore;
use super::wire::GoalWire;
use crate::domains::sessions::model::SessionEventRecord;

pub const MAX_GOAL_OBJECTIVE_BYTES: usize = 16 * 1024;

/// The three native notification kinds the sidecars emit (GoalPort wire
/// contract v1 tagged chunks).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalNativeEventKind {
    Updated,
    Met,
    Cleared,
}

/// Where a native goal payload came from — this decides how a cleared mirror
/// treats an incoming goal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GoalIngestSource {
    /// A tagged notification chunk observed off the live session. After an
    /// explicit clear these can be stale in-flight echoes of the just-cleared
    /// goal, which must not resurrect it.
    Notification,
    /// An authoritative native read (`_anyharness/goal/get`) on attach/resume
    /// — reflects native truth verbatim, so it always wins.
    Reconcile,
}

/// The transition an incoming native goal payload applies to the mirror.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GoalTransition {
    /// Update the existing head row in place (same goal lifetime).
    Update,
    /// Insert a new record (a fresh goal lifetime).
    Insert,
    /// Ignore the payload entirely (a stale post-clear echo).
    Drop,
}

#[derive(Debug, Clone)]
pub struct GoalEventContext {
    pub workspace_id: String,
    pub session_id: String,
    pub source_agent_kind: String,
    pub turn_id: Option<String>,
    pub next_seq: i64,
}

#[derive(Debug, Clone)]
pub struct GoalEventBatch {
    pub goal: Option<GoalRecord>,
    pub envelopes: Vec<SessionEventEnvelope>,
}

impl GoalEventBatch {
    fn unchanged(goal: Option<GoalRecord>) -> Self {
        Self {
            goal,
            envelopes: Vec::new(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum GoalIngestError {
    #[error("goal notification payload is missing its goal")]
    MissingGoalPayload,
    #[error("goal objective exceeds {MAX_GOAL_OBJECTIVE_BYTES} bytes")]
    ObjectiveTooLarge,
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

/// Mirror-keeping over the goals table. Records transition ONLY through the
/// native-notification ingest paths here ([`ingest_native_event`],
/// [`reconcile_native_state`]); external mutations leave nothing but a thin
/// [`GoalPendingOp`] marker until the native round-trip lands.
#[derive(Clone)]
pub struct GoalService {
    store: GoalStore,
}

impl GoalService {
    pub fn new(store: GoalStore) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &GoalStore {
        &self.store
    }

    pub fn current_goal(&self, session_id: &str) -> anyhow::Result<Option<GoalRecord>> {
        self.store.find_current(session_id)
    }

    pub fn mark_pending(&self, session_id: &str, op: GoalPendingOp) -> anyhow::Result<()> {
        self.store.set_pending_op(session_id, Some(op))
    }

    pub fn clear_pending(&self, session_id: &str) -> anyhow::Result<()> {
        self.store.set_pending_op(session_id, None)
    }

    /// Ingests one sidecar goal notification: transitions the mirror row and
    /// persists the matching contract event rows in a single transaction,
    /// returning every committed envelope (the observer partial-failure
    /// contract). Idempotent: a notification that changes nothing commits
    /// nothing and returns no envelopes.
    pub fn ingest_native_event(
        &self,
        context: GoalEventContext,
        kind: GoalNativeEventKind,
        wire: Option<GoalWire>,
    ) -> Result<GoalEventBatch, GoalIngestError> {
        self.ingest_native_event_from(context, kind, wire, GoalIngestSource::Notification)
    }

    fn ingest_native_event_from(
        &self,
        context: GoalEventContext,
        kind: GoalNativeEventKind,
        wire: Option<GoalWire>,
        source: GoalIngestSource,
    ) -> Result<GoalEventBatch, GoalIngestError> {
        if let Some(wire) = wire.as_ref() {
            if wire.objective.len() > MAX_GOAL_OBJECTIVE_BYTES {
                return Err(GoalIngestError::ObjectiveTooLarge);
            }
        }
        match kind {
            GoalNativeEventKind::Updated | GoalNativeEventKind::Met => {
                let wire = wire.ok_or(GoalIngestError::MissingGoalPayload)?;
                self.apply_native_goal(context, kind, wire, source)
                    .map_err(GoalIngestError::Store)
            }
            GoalNativeEventKind::Cleared => {
                self.apply_native_clear(context).map_err(GoalIngestError::Store)
            }
        }
    }

    /// Heals the mirror from an explicit native read (`_anyharness/goal/get`
    /// on attach/resume). `None` means the harness has no goal: a non-terminal
    /// mirror is then marked cleared; terminal `met`/`failed` mirrors stay (a
    /// met claude goal auto-clears natively but remains our sticky result).
    pub fn reconcile_native_state(
        &self,
        context: GoalEventContext,
        wire: Option<GoalWire>,
    ) -> Result<GoalEventBatch, GoalIngestError> {
        match wire {
            Some(wire) => {
                let kind = if wire.status.to_contract() == GoalStatus::Met {
                    GoalNativeEventKind::Met
                } else {
                    GoalNativeEventKind::Updated
                };
                self.ingest_native_event_from(context, kind, Some(wire), GoalIngestSource::Reconcile)
            }
            None => {
                let current = self.store.find_current(&context.session_id)?;
                match current {
                    Some(goal) if !goal.status.is_terminal() => {
                        self.apply_native_clear(context).map_err(GoalIngestError::Store)
                    }
                    other => Ok(GoalEventBatch::unchanged(other)),
                }
            }
        }
    }

    fn apply_native_goal(
        &self,
        context: GoalEventContext,
        kind: GoalNativeEventKind,
        wire: GoalWire,
        source: GoalIngestSource,
    ) -> anyhow::Result<GoalEventBatch> {
        self.store.with_tx_anyhow(|tx| {
            let now = chrono::Utc::now().to_rfc3339();
            let native_state_json = Some(serde_json::to_string(&wire)?);
            let status = match kind {
                GoalNativeEventKind::Met => GoalStatus::Met,
                _ => wire.status.to_contract(),
            };

            let latest = GoalStore::find_latest_tx(tx, &context.session_id)?;
            let goal = match classify_goal_transition(latest.as_ref(), &wire, status, source) {
                GoalTransition::Drop => return Ok(GoalEventBatch::unchanged(None)),
                GoalTransition::Update => {
                    let existing = latest.expect("update transition implies a head row");
                    let next = GoalRecord {
                        objective: wire.objective.clone(),
                        status,
                        native_status: wire.native_status.clone(),
                        token_budget: wire.token_budget,
                        tokens_used: wire.tokens_used,
                        time_used_seconds: wire.time_used_seconds,
                        met_reason: wire.met_reason.clone().or_else(|| existing.met_reason.clone()),
                        iterations: wire.iterations,
                        native: wire.native,
                        pending_op: None,
                        revision: existing.revision,
                        native_state_json,
                        updated_at: now,
                        ..existing.clone()
                    };
                    if goal_content_unchanged(&existing, &next) {
                        // Content is identical — no revision bump or event.
                        // However, if a pending_op marker is outstanding, clear
                        // it: the ingest confirmation proves the native state
                        // matches, so the pending op is resolved.
                        if existing.pending_op.is_some() {
                            GoalStore::clear_pending_op_tx(tx, &existing.id)?;
                        }
                        return Ok(GoalEventBatch::unchanged(Some(existing)));
                    }
                    let next = GoalRecord {
                        revision: existing.revision + 1,
                        ..next
                    };
                    GoalStore::update_goal(tx, &next)?;
                    next
                }
                GoalTransition::Insert => {
                    let goal = GoalRecord {
                        id: uuid::Uuid::new_v4().to_string(),
                        workspace_id: context.workspace_id.clone(),
                        session_id: context.session_id.clone(),
                        objective: wire.objective.clone(),
                        status,
                        native_status: wire.native_status.clone(),
                        token_budget: wire.token_budget,
                        tokens_used: wire.tokens_used,
                        time_used_seconds: wire.time_used_seconds,
                        met_reason: wire.met_reason.clone(),
                        iterations: wire.iterations,
                        native: wire.native,
                        pending_op: None,
                        revision: 1,
                        native_state_json,
                        created_at: now.clone(),
                        updated_at: now,
                    };
                    GoalStore::insert_goal(tx, &goal)?;
                    goal
                }
            };

            let event = match kind {
                GoalNativeEventKind::Met => SessionEvent::GoalMet(GoalMetPayload {
                    goal: goal.to_contract(),
                }),
                _ => SessionEvent::GoalUpdated(GoalUpdatedPayload {
                    goal: goal.to_contract(),
                }),
            };
            let envelope = envelope(&context, context.next_seq, event);
            GoalStore::insert_event(tx, &event_record(&envelope)?)?;
            Ok(GoalEventBatch {
                goal: Some(goal),
                envelopes: vec![envelope],
            })
        })
    }

    fn apply_native_clear(&self, context: GoalEventContext) -> anyhow::Result<GoalEventBatch> {
        self.store.with_tx_anyhow(|tx| {
            let Some(existing) = GoalStore::find_current_tx(tx, &context.session_id)? else {
                return Ok(GoalEventBatch::unchanged(None));
            };
            if existing.status == GoalStatus::Cleared {
                return Ok(GoalEventBatch::unchanged(Some(existing)));
            }
            let goal = GoalRecord {
                status: GoalStatus::Cleared,
                pending_op: None,
                revision: existing.revision + 1,
                updated_at: chrono::Utc::now().to_rfc3339(),
                ..existing
            };
            GoalStore::update_goal(tx, &goal)?;
            let envelope = envelope(
                &context,
                context.next_seq,
                SessionEvent::GoalCleared(GoalClearedPayload {
                    goal: goal.to_contract(),
                }),
            );
            GoalStore::insert_event(tx, &event_record(&envelope)?)?;
            Ok(GoalEventBatch {
                goal: Some(goal),
                envelopes: vec![envelope],
            })
        })
    }
}

/// Decides how an incoming native goal payload transitions the mirror,
/// keyed off the single latest row (the head of the lifecycle chain).
fn classify_goal_transition(
    latest: Option<&GoalRecord>,
    wire: &GoalWire,
    status: GoalStatus,
    source: GoalIngestSource,
) -> GoalTransition {
    let Some(existing) = latest else {
        // No prior goal for the session — the first one.
        return GoalTransition::Insert;
    };

    if existing.status == GoalStatus::Cleared {
        // The mirror was explicitly cleared. A native goal payload arriving
        // now is a stale in-flight echo of the just-cleared goal (a late
        // accounting/eval flush) and must NOT resurrect it — UNLESS it is an
        // authoritative reconcile read, or the caller has a set in flight
        // (`pending_op == Set`), either of which mints a genuinely new goal.
        return match source {
            GoalIngestSource::Reconcile => GoalTransition::Insert,
            GoalIngestSource::Notification
                if existing.pending_op == Some(GoalPendingOp::Set) =>
            {
                GoalTransition::Insert
            }
            GoalIngestSource::Notification => GoalTransition::Drop,
        };
    }

    if !existing.status.is_terminal() {
        // An ongoing goal: edits, status moves, and accounting flushes update
        // the same record in place.
        return GoalTransition::Update;
    }

    // A terminal (met/failed) head. A same-objective payload that is itself
    // terminal is an idempotent echo of the same completed goal (a duplicate
    // met, or a reconcile re-read) — update in place (a no-op via
    // `goal_content_unchanged`). Anything else — a re-arm back to a live
    // status, or a different objective — starts a fresh record so the new
    // pursuit never inherits the old goal's identity, revision lineage, or
    // stale met_reason.
    if existing.objective == wire.objective && status.is_terminal() {
        GoalTransition::Update
    } else {
        GoalTransition::Insert
    }
}

/// Content equality for idempotent ingest: everything the wire can move,
/// excluding the bookkeeping fields (`revision`, timestamps, raw json) and the
/// local-only `pending_op` marker (which tracks in-flight mutations and must
/// not trigger spurious revision bumps when it is the only difference).
fn goal_content_unchanged(existing: &GoalRecord, next: &GoalRecord) -> bool {
    existing.objective == next.objective
        && existing.status == next.status
        && existing.native_status == next.native_status
        && existing.token_budget == next.token_budget
        && existing.tokens_used == next.tokens_used
        && existing.time_used_seconds == next.time_used_seconds
        && existing.met_reason == next.met_reason
        && existing.iterations == next.iterations
        && existing.native == next.native
}

pub fn goal_to_contract(goal: &GoalRecord) -> Goal {
    goal.to_contract()
}

fn envelope(context: &GoalEventContext, seq: i64, event: SessionEvent) -> SessionEventEnvelope {
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
