use crate::live::sessions::actor::*;
pub struct SessionTurnFinishResult {
    pub session_id: String,
    pub turn_id: String,
    pub outcome: SessionTurnOutcome,
    pub stop_reason: Option<String>,
    pub last_event_seq: i64,
    pub error_details: Option<ErrorEventDetails>,
}
