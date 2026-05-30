use super::model::{SubagentCompletionRecord, SubagentCompletionSummary};

pub(super) fn completion_to_summary(wake: SubagentCompletionRecord) -> SubagentCompletionSummary {
    SubagentCompletionSummary {
        completion_id: wake.completion_id,
        child_turn_id: wake.child_turn_id,
        outcome: wake.outcome,
        child_last_event_seq: wake.child_last_event_seq,
        created_at: wake.created_at,
        parent_event_seq: wake.parent_event_seq,
        parent_prompt_seq: wake.parent_prompt_seq,
    }
}
