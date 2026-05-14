use anyharness_contract::v1::{SubagentCompletionSummary, SubagentTurnOutcome};

use super::model::SubagentCompletionRecord;
use crate::sessions::extensions::SessionTurnOutcome;

pub(super) fn completion_to_contract(wake: SubagentCompletionRecord) -> SubagentCompletionSummary {
    SubagentCompletionSummary {
        completion_id: wake.completion_id,
        child_turn_id: wake.child_turn_id,
        outcome: match wake.outcome {
            SessionTurnOutcome::Completed => SubagentTurnOutcome::Completed,
            SessionTurnOutcome::Failed => SubagentTurnOutcome::Failed,
            SessionTurnOutcome::Cancelled => SubagentTurnOutcome::Cancelled,
        },
        child_last_event_seq: wake.child_last_event_seq,
        created_at: wake.created_at,
        parent_event_seq: wake.parent_event_seq,
        parent_prompt_seq: wake.parent_prompt_seq,
    }
}
