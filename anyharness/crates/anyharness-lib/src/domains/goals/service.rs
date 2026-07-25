//! `GoalService`: mirror transitions for the goals domain.
//!
//! # Source-of-truth contract (spec §2.3 / wire contract)
//!
//! The sidecar's tagged notifications are the source of truth for mirror
//! transitions. Runtime writes call the ext methods and record only a
//! [`GoalWriteIntent`] (caps + provenance) here; [`GoalService::ingest_wire_event`]
//! folds the pending intent into the row when the round-trip lands.
//!
//! # Partial-failure contract
//!
//! Every event-emitting method persists the goal row and its event rows in a
//! single transaction and returns EVERY committed envelope — the same
//! contract `PlanService` satisfies for the observer dispatch pass.

use std::collections::HashMap;
use std::sync::Mutex;

use anyharness_contract::v1::{
    Goal, GoalClearedEvent, GoalMetEvent, GoalStatus, GoalUpdatedEvent, SessionEvent,
    SessionEventEnvelope,
};

use super::model::{goal_to_contract, GoalRecord, GoalWriteIntent};
use super::store::GoalStore;
use super::wire::GoalWire;
use crate::domains::sessions::model::SessionEventRecord;
use rusqlite::OptionalExtension;

/// Guard verdict reason for budget-exhausted goals (spec §2.4).
pub const GOAL_FAIL_REASON_BUDGET_EXHAUSTED: &str = "budget_exhausted";

#[derive(Debug, Clone)]
pub struct GoalEventContext {
    pub session_id: String,
    pub workspace_id: String,
    pub turn_id: Option<String>,
    /// The locked sink counter at this point in the dispatch pass; event
    /// rows are stamped starting at this seq.
    pub next_seq: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalIngestKind {
    Updated,
    Met,
    Cleared,
}

pub struct GoalService {
    store: GoalStore,
    /// Pending runtime write intents, keyed by session id. Consumed by the
    /// next `goal_updated` ingest for that session.
    write_intents: Mutex<HashMap<String, GoalWriteIntent>>,
}

const DEFAULT_WORKSPACE_GOAL_LIMIT: usize = 100;

impl GoalService {
    pub fn new(store: GoalStore) -> Self {
        Self {
            store,
            write_intents: Mutex::new(HashMap::new()),
        }
    }

    pub fn store(&self) -> &GoalStore {
        &self.store
    }

    pub fn get(&self, goal_id: &str) -> anyhow::Result<Option<GoalRecord>> {
        self.store.find_by_id(goal_id)
    }

    pub fn active_goal_for_session(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<GoalRecord>> {
        self.store.find_non_terminal_by_session(session_id)
    }

    pub fn list_by_workspace(&self, workspace_id: &str) -> anyhow::Result<Vec<GoalRecord>> {
        self.store
            .list_by_workspace(workspace_id, DEFAULT_WORKSPACE_GOAL_LIMIT)
    }

    /// Record the caps/provenance of a runtime write about to round-trip
    /// through the sidecar. Replaces any prior intent for the session.
    pub fn record_write_intent(&self, session_id: &str, intent: GoalWriteIntent) {
        self.write_intents
            .lock()
            .expect("goal write intents lock poisoned")
            .insert(session_id.to_string(), intent);
    }

    fn take_write_intent(&self, session_id: &str) -> Option<GoalWriteIntent> {
        self.write_intents
            .lock()
            .expect("goal write intents lock poisoned")
            .remove(session_id)
    }

    /// Ingest one tagged sidecar notification (the mirror's source of
    /// truth). Persists the transition + event rows in one tx and returns
    /// the committed envelopes.
    pub fn ingest_wire_event(
        &self,
        ctx: &GoalEventContext,
        kind: GoalIngestKind,
        wire: Option<&serde_json::Value>,
    ) -> anyhow::Result<Vec<SessionEventEnvelope>> {
        match kind {
            GoalIngestKind::Cleared => self.transition_non_terminal(
                ctx,
                GoalStatus::Cleared,
                None,
                |goal| SessionEvent::GoalCleared(GoalClearedEvent { goal }),
            ),
            GoalIngestKind::Updated | GoalIngestKind::Met => {
                let Some(wire_value) = wire else {
                    tracing::warn!(
                        session_id = %ctx.session_id,
                        "goal wire event missing goal payload; skipping"
                    );
                    return Ok(Vec::new());
                };
                let Some(parsed) = GoalWire::from_value(wire_value) else {
                    tracing::warn!(
                        session_id = %ctx.session_id,
                        "goal wire payload failed to parse; skipping"
                    );
                    return Ok(Vec::new());
                };
                self.apply_wire_update(ctx, kind, &parsed, wire_value)
            }
        }
    }

    fn apply_wire_update(
        &self,
        ctx: &GoalEventContext,
        kind: GoalIngestKind,
        wire: &GoalWire,
        raw_wire: &serde_json::Value,
    ) -> anyhow::Result<Vec<SessionEventEnvelope>> {
        let intent = self.take_write_intent(&ctx.session_id);
        let now = chrono::Utc::now().to_rfc3339();
        let status = if kind == GoalIngestKind::Met {
            GoalStatus::Met
        } else {
            wire.normalized_status()
        };
        let native_state_json = raw_wire.to_string();

        self.store.with_tx_anyhow(|tx| {
            let existing =
                GoalStore::find_non_terminal_by_session_tx(tx, &ctx.session_id).optional()?;
            let goal = match existing {
                Some(mut goal) => {
                    if let Some(objective) = wire
                        .objective
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                    {
                        goal.objective = objective.to_string();
                    }
                    goal.status = status;
                    goal.token_budget = wire.token_budget.or(goal.token_budget);
                    goal.tokens_used = wire.tokens_used.or(goal.tokens_used);
                    goal.time_used_secs = wire.time_used_seconds.or(goal.time_used_secs);
                    goal.met_reason = wire.met_reason.clone().or(goal.met_reason);
                    if let Some(intent) = &intent {
                        goal.source_kind = intent.source_kind.clone();
                        goal.source_run_id = intent.source_run_id.clone();
                        goal.max_turns = intent.max_turns;
                        goal.max_wall_secs = intent.max_wall_secs;
                    }
                    goal.native_state_json = native_state_json.clone();
                    goal.revision += 1;
                    goal.updated_at = now.clone();
                    if status.is_terminal() && goal.met_at.is_none() {
                        goal.met_at = Some(now.clone());
                    }
                    GoalStore::update_goal(tx, &goal)?;
                    goal
                }
                None => {
                    let objective = wire
                        .objective
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty());
                    let Some(objective) = objective else {
                        // A terminal/patch notification with no objective and
                        // no live row: nothing to mirror.
                        return Ok(Vec::new());
                    };
                    let intent = intent.clone().unwrap_or(GoalWriteIntent {
                        source_kind: "agent".to_string(),
                        ..GoalWriteIntent::default()
                    });
                    let goal = GoalRecord {
                        id: uuid::Uuid::new_v4().to_string(),
                        workspace_id: ctx.workspace_id.clone(),
                        session_id: ctx.session_id.clone(),
                        objective: objective.to_string(),
                        status,
                        source_kind: intent.source_kind,
                        source_run_id: intent.source_run_id,
                        token_budget: wire.token_budget,
                        max_turns: intent.max_turns,
                        max_wall_secs: intent.max_wall_secs,
                        tokens_used: wire.tokens_used,
                        time_used_secs: wire.time_used_seconds,
                        turns_used: 0,
                        met_reason: wire.met_reason.clone(),
                        native_state_json: native_state_json.clone(),
                        revision: 1,
                        created_at: now.clone(),
                        updated_at: now.clone(),
                        met_at: status.is_terminal().then(|| now.clone()),
                    };
                    GoalStore::insert_goal(tx, &goal)?;
                    goal
                }
            };

            let contract = goal_to_contract(&goal);
            let event = match kind {
                GoalIngestKind::Met => SessionEvent::GoalMet(GoalMetEvent { goal: contract }),
                _ => SessionEvent::GoalUpdated(GoalUpdatedEvent { goal: contract }),
            };
            let envelope = envelope(ctx, ctx.next_seq, event);
            GoalStore::insert_event(tx, &event_record(&envelope)?)?;
            Ok(vec![envelope])
        })
    }

    /// Guard path (spec §2.4): force the non-terminal goal to `failed` with
    /// a typed reason, in-context (live session, seq supplied by the sink).
    pub fn fail_non_terminal_with_context(
        &self,
        ctx: &GoalEventContext,
        reason: &str,
    ) -> anyhow::Result<Vec<SessionEventEnvelope>> {
        self.transition_non_terminal(ctx, GoalStatus::Failed, Some(reason.to_string()), |goal| {
            SessionEvent::GoalUpdated(GoalUpdatedEvent { goal })
        })
    }

    /// Offline variant: seq assigned from the database. Callers must have
    /// confirmed no live actor owns event sequencing for this session.
    pub fn fail_non_terminal_offline(
        &self,
        session_id: &str,
        workspace_id: &str,
        reason: &str,
    ) -> anyhow::Result<Vec<SessionEventEnvelope>> {
        let session_id_owned = session_id.to_string();
        let workspace_id = workspace_id.to_string();
        let reason = reason.to_string();
        self.store.with_tx_anyhow(move |tx| {
            let seq = GoalStore::next_event_seq(tx, &session_id_owned)?;
            let ctx = GoalEventContext {
                session_id: session_id_owned,
                workspace_id,
                turn_id: None,
                next_seq: seq,
            };
            transition_non_terminal_tx(tx, &ctx, GoalStatus::Failed, Some(reason), |goal| {
                SessionEvent::GoalUpdated(GoalUpdatedEvent { goal })
            })
        })
    }

    fn transition_non_terminal(
        &self,
        ctx: &GoalEventContext,
        status: GoalStatus,
        reason: Option<String>,
        to_event: impl FnOnce(Goal) -> SessionEvent,
    ) -> anyhow::Result<Vec<SessionEventEnvelope>> {
        self.store
            .with_tx_anyhow(|tx| transition_non_terminal_tx(tx, ctx, status, reason, to_event))
    }
}

fn transition_non_terminal_tx(
    tx: &rusqlite::Connection,
    ctx: &GoalEventContext,
    status: GoalStatus,
    reason: Option<String>,
    to_event: impl FnOnce(Goal) -> SessionEvent,
) -> anyhow::Result<Vec<SessionEventEnvelope>> {
    let Some(mut goal) =
        GoalStore::find_non_terminal_by_session_tx(tx, &ctx.session_id).optional()?
    else {
        return Ok(Vec::new());
    };
    let now = chrono::Utc::now().to_rfc3339();
    goal.status = status;
    if reason.is_some() {
        goal.met_reason = reason;
    }
    goal.revision += 1;
    goal.updated_at = now.clone();
    if status.is_terminal() && goal.met_at.is_none() {
        goal.met_at = Some(now);
    }
    GoalStore::update_goal(tx, &goal)?;

    let envelope = envelope(ctx, ctx.next_seq, to_event(goal_to_contract(&goal)));
    GoalStore::insert_event(tx, &event_record(&envelope)?)?;
    Ok(vec![envelope])
}

fn envelope(ctx: &GoalEventContext, seq: i64, event: SessionEvent) -> SessionEventEnvelope {
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
