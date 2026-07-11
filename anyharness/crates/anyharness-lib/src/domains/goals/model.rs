use anyharness_contract::v1::{Goal, GoalSourceKind, GoalStatus};

/// The persisted goal mirror: one row per goal lifetime, transitioned only by
/// observer-ingested native notifications (plus reconcile-on-attach reads).
/// The only locally-written state is the thin `pending_op` marker for
/// in-flight external mutations, plus the anyharness-side augmentation the
/// native harness has no concept of: caps (`max_turns`, `max_wall_secs`),
/// provenance (`source_kind`, `source_run_id`), the cap-guard bookkeeping
/// (`guard_turns_used`, `guard_started_at`) and the typed `failed_reason` the
/// guard writes on a breach.
#[derive(Debug, Clone)]
pub struct GoalRecord {
    pub id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub objective: String,
    pub status: GoalStatus,
    pub native_status: Option<String>,
    pub token_budget: Option<i64>,
    /// Runtime-enforced cap, never forwarded to the sidecar.
    pub max_turns: Option<u32>,
    /// Runtime-enforced cap, never forwarded to the sidecar.
    pub max_wall_secs: Option<u64>,
    pub tokens_used: Option<i64>,
    pub time_used_seconds: Option<i64>,
    pub met_reason: Option<String>,
    /// Typed reason for a `failed` transition written by the cap guard.
    pub failed_reason: Option<String>,
    pub iterations: Option<i64>,
    /// Provenance — who armed this goal (defaults to `user`).
    pub source_kind: GoalSourceKind,
    /// The workflow run that armed the goal, when `source_kind = workflow`.
    pub source_run_id: Option<String>,
    pub native: bool,
    pub pending_op: Option<GoalPendingOp>,
    pub revision: i64,
    pub native_state_json: Option<String>,
    /// Turns counted by the cap guard for the current objective. Resets to 0
    /// when the objective changes (matching Claude-native goal semantics); a
    /// bare edit that leaves the objective intact keeps the count.
    pub guard_turns_used: i64,
    /// When the current objective's cap window opened (RFC3339). Set when the
    /// goal is inserted and reset on objective change; the wall-clock cap is
    /// measured from here.
    pub guard_started_at: Option<String>,
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
            max_turns: self.max_turns,
            max_wall_secs: self.max_wall_secs,
            tokens_used: self.tokens_used,
            time_used_seconds: self.time_used_seconds,
            met_reason: self.met_reason.clone(),
            failed_reason: self.failed_reason.clone(),
            iterations: self.iterations,
            source_kind: self.source_kind,
            source_run_id: self.source_run_id.clone(),
            native: self.native,
            revision: self.revision,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

/// The typed reason the cap guard records when it fails a goal for exceeding a
/// runtime cap. The string form is the `failed_reason` written to the mirror
/// and carried on the emitted `goal_updated` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalFailReason {
    MaxTurnsExhausted,
    MaxWallSecsExhausted,
}

impl GoalFailReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MaxTurnsExhausted => "max_turns_exhausted",
            Self::MaxWallSecsExhausted => "max_wall_secs_exhausted",
        }
    }
}

/// The cap guard's per-turn verdict: keep going, or fail the goal for a
/// specific breached cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalGuardDecision {
    Breached(GoalFailReason),
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
