use anyharness_contract::v1::SessionEventEnvelope;

#[derive(Debug, Clone)]
pub struct SubagentWakeTurnPersistenceInput {
    pub session_id: String,
    pub queue_seq: i64,
    pub events: Vec<SessionEventEnvelope>,
    pub admitted_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubagentWakeTurnPersistenceOutcome {
    Admitted,
    AlreadyVisible { parent_turn_id: String },
    Discarded,
    Stale,
}
