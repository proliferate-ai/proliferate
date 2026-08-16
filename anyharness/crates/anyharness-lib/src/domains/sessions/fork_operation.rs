//! Forks ADR rung 2: the durable fork-operation model types. Split out of
//! `model.rs` (per `guides/domains.md`, split on growth) so the session model
//! file stays within the repo line budget. Re-exported from `model` for
//! backwards-compatible import paths.

/// Forks ADR rung 2: the phase of a durable fork operation. Advances forward
/// only. `native_call_in_flight` is marked before dispatch; a lost native
/// outcome parks the record at `native_outcome_unknown`, which blocks blind
/// redispatch (ADR 4.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForkOperationPhase {
    Prepared,
    NativeCallInFlight,
    NativeResultKnown,
    NativeOutcomeUnknown,
    ChildPersisted,
    Completed,
    Failed,
}

impl ForkOperationPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            ForkOperationPhase::Prepared => "prepared",
            ForkOperationPhase::NativeCallInFlight => "native_call_in_flight",
            ForkOperationPhase::NativeResultKnown => "native_result_known",
            ForkOperationPhase::NativeOutcomeUnknown => "native_outcome_unknown",
            ForkOperationPhase::ChildPersisted => "child_persisted",
            ForkOperationPhase::Completed => "completed",
            ForkOperationPhase::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        Ok(match value {
            "prepared" => ForkOperationPhase::Prepared,
            "native_call_in_flight" => ForkOperationPhase::NativeCallInFlight,
            "native_result_known" => ForkOperationPhase::NativeResultKnown,
            "native_outcome_unknown" => ForkOperationPhase::NativeOutcomeUnknown,
            "child_persisted" => ForkOperationPhase::ChildPersisted,
            "completed" => ForkOperationPhase::Completed,
            "failed" => ForkOperationPhase::Failed,
            other => anyhow::bail!("unknown fork operation phase: {other}"),
        })
    }

    /// A parked, non-terminal phase whose native outcome is unknown. Redispatch
    /// on the same idempotency key is refused while a record is in this phase.
    pub fn blocks_redispatch(self) -> bool {
        matches!(self, ForkOperationPhase::NativeOutcomeUnknown)
    }
}

/// Forks ADR rung 2: one durable record per fork operation, carrying identity/
/// idempotency and provenance together (ADR 4.4). Persisted in the `prepared`
/// phase before any native call.
#[derive(Debug, Clone)]
pub struct ForkOperationRecord {
    pub id: String,
    pub idempotency_key: String,
    pub request_digest: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub phase: ForkOperationPhase,
    /// Product anchor `(turn_id, item_id)`; both `None` for a tip fork.
    pub anchor_turn_id: Option<String>,
    pub anchor_item_id: Option<String>,
    pub provider_anchor_kind: Option<String>,
    pub provider_anchor_value: Option<String>,
    pub provider_anchor_inclusive: Option<bool>,
    pub prefix_terminal_seq: Option<i64>,
    pub prefix_digest: Option<String>,
    pub adapter_version: Option<String>,
    pub native_version: Option<String>,
    pub native_child_session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
