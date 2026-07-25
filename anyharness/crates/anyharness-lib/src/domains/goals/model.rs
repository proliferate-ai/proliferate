use anyharness_contract::v1::{Goal, GoalStatus};

use super::wire::GoalWire;

/// The normalized goal mirror row (spec §2.1). One row per goal lifetime;
/// edits update the row and bump `revision` — history is the event stream.
#[derive(Debug, Clone)]
pub struct GoalRecord {
    pub id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub objective: String,
    pub status: GoalStatus,
    pub source_kind: String,
    pub source_run_id: Option<String>,
    pub token_budget: Option<i64>,
    pub max_turns: Option<i64>,
    pub max_wall_secs: Option<i64>,
    pub tokens_used: Option<i64>,
    pub time_used_secs: Option<i64>,
    pub turns_used: i64,
    pub met_reason: Option<String>,
    /// Raw native payload (the last ingested `GoalWire`) for fidelity/debug.
    pub native_state_json: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub met_at: Option<String>,
}

impl GoalRecord {
    pub fn is_terminal(&self) -> bool {
        self.status.is_terminal()
    }
}

/// Caps + provenance recorded by a runtime write before the ext-method call.
/// The mirror transition happens on notification ingest; the observer folds
/// the pending intent into the row then (spec §2.3: no optimistic state).
#[derive(Debug, Clone, Default)]
pub struct GoalWriteIntent {
    pub source_kind: String,
    pub source_run_id: Option<String>,
    pub max_turns: Option<i64>,
    pub max_wall_secs: Option<i64>,
}

pub fn goal_to_contract(record: &GoalRecord) -> Goal {
    let wire = GoalWire::parse_lenient(&record.native_state_json);
    Goal {
        id: record.id.clone(),
        workspace_id: record.workspace_id.clone(),
        session_id: record.session_id.clone(),
        objective: record.objective.clone(),
        status: record.status,
        native_status: wire.as_ref().and_then(|wire| wire.native_status.clone()),
        source_kind: record.source_kind.clone(),
        source_run_id: record.source_run_id.clone(),
        token_budget: record.token_budget,
        max_turns: record.max_turns,
        max_wall_secs: record.max_wall_secs,
        tokens_used: record.tokens_used,
        time_used_secs: record.time_used_secs,
        turns_used: record.turns_used,
        met_reason: record.met_reason.clone(),
        native: wire.as_ref().and_then(|wire| wire.native).unwrap_or(true),
        revision: record.revision,
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        met_at: record.met_at.clone(),
    }
}
