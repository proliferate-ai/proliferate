use anyharness_contract::v1::{Goal, GoalStatus};

/// The persisted goal mirror: one row per goal lifetime, transitioned only by
/// observer-ingested native notifications (plus reconcile-on-attach reads).
/// The only locally-written state is the thin `pending_op` marker for
/// in-flight external mutations.
#[derive(Debug, Clone)]
pub struct GoalRecord {
    pub id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub objective: String,
    pub status: GoalStatus,
    pub native_status: Option<String>,
    pub token_budget: Option<i64>,
    pub tokens_used: Option<i64>,
    pub time_used_seconds: Option<i64>,
    pub met_reason: Option<String>,
    pub iterations: Option<i64>,
    pub native: bool,
    pub pending_op: Option<GoalPendingOp>,
    pub revision: i64,
    pub native_state_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl GoalRecord {
    pub fn to_contract(&self) -> Goal {
        Goal {
            objective: self.objective.clone(),
            status: self.status,
            native_status: self.native_status.clone(),
            token_budget: self.token_budget,
            tokens_used: self.tokens_used,
            time_used_seconds: self.time_used_seconds,
            met_reason: self.met_reason.clone(),
            iterations: self.iterations,
            native: self.native,
            revision: self.revision,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

/// Thin marker for an in-flight external mutation. Never an optimistic state
/// transition — the record's `status` moves only on the native round-trip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalPendingOp {
    Set,
    Clear,
}

impl GoalPendingOp {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Set => "set",
            Self::Clear => "clear",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "set" => Some(Self::Set),
            "clear" => Some(Self::Clear),
            _ => None,
        }
    }
}
