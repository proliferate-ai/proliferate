use anyharness_contract::v1::ErrorEventDetails;

use crate::domains::sessions::extensions::SessionTurnOutcome;
pub struct SessionTurnFinishResult {
    pub session_id: String,
    pub turn_id: String,
    /// The actor's prompt diagnostics prompt id, threaded through so workflow
    /// completion can match exact prompt identity. `None` for prompts with no
    /// caller-supplied id.
    pub prompt_id: Option<String>,
    pub outcome: SessionTurnOutcome,
    pub stop_reason: Option<String>,
    pub last_event_seq: i64,
    pub error_details: Option<ErrorEventDetails>,
}
