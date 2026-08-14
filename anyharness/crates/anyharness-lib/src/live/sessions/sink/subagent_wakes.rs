use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemStartedEvent, PendingPromptRemovalReason,
    PendingPromptRemovedPayload, PromptProvenance, SessionEvent, TranscriptItemKind,
    TranscriptItemPayload, TranscriptItemStatus, TurnStartedEvent,
};

use super::publish::build_session_event;
use super::SessionEventSink;
use crate::live::sessions::subagent_wake::{
    SubagentWakeTurnPersistenceInput, SubagentWakeTurnPersistenceOutcome,
};
use crate::observability::transcript_phase::record_transcript_phase_event;

pub(in crate::live::sessions) enum SubagentWakeTurnStartOutcome {
    Admitted { turn_id: String },
    AlreadyVisible,
    Discarded,
    Stale,
}

impl SessionEventSink {
    pub(in crate::live::sessions) fn persist_subagent_wake_turn(
        &mut self,
        prompt_text: String,
        prompt_id: Option<String>,
        content_parts: Vec<ContentPart>,
        prompt_provenance: Option<PromptProvenance>,
        queue_seq: i64,
    ) -> anyhow::Result<SubagentWakeTurnStartOutcome> {
        self.prepare_for_prompt_turn()?;
        anyhow::ensure!(
            self.current_turn_id.is_none()
                && self.staged_terminal.is_none()
                && self.open_assistant_item.is_none()
                && self.open_reasoning_item.is_none()
                && self.open_plan_item.is_none()
                && self.tool_items.is_empty(),
            "completion wake requires an idle transcript sink"
        );

        let turn_id = uuid::Uuid::new_v4().to_string();
        let item_id = uuid::Uuid::new_v4().to_string();
        let item = TranscriptItemPayload {
            kind: TranscriptItemKind::UserMessage,
            status: TranscriptItemStatus::Completed,
            source_agent_kind: self.source_agent_kind.clone(),
            is_transient: false,
            message_id: None,
            prompt_id: prompt_id.clone(),
            title: None,
            tool_call_id: None,
            native_tool_name: None,
            parent_tool_call_id: None,
            raw_input: None,
            raw_output: None,
            content_parts: if content_parts.is_empty() {
                vec![ContentPart::Text { text: prompt_text }]
            } else {
                content_parts
            },
            prompt_provenance,
        };
        let mut staged_next_seq = self.next_seq;
        let events = vec![
            build_session_event(
                &self.session_id,
                &mut staged_next_seq,
                SessionEvent::TurnStarted(TurnStartedEvent::default()),
                Some(turn_id.clone()),
                None,
            ),
            build_session_event(
                &self.session_id,
                &mut staged_next_seq,
                SessionEvent::ItemStarted(ItemStartedEvent { item: item.clone() }),
                Some(turn_id.clone()),
                Some(item_id.clone()),
            ),
            build_session_event(
                &self.session_id,
                &mut staged_next_seq,
                SessionEvent::ItemCompleted(ItemCompletedEvent { item }),
                Some(turn_id.clone()),
                Some(item_id),
            ),
            build_session_event(
                &self.session_id,
                &mut staged_next_seq,
                SessionEvent::PendingPromptRemoved(PendingPromptRemovedPayload {
                    seq: queue_seq,
                    prompt_id,
                    reason: PendingPromptRemovalReason::Executed,
                }),
                None,
                None,
            ),
        ];
        let admitted_at = events
            .last()
            .map(|event| event.timestamp.clone())
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let outcome = self
            .store
            .persist_subagent_wake_turn(&SubagentWakeTurnPersistenceInput {
                session_id: self.session_id.clone(),
                queue_seq,
                events: events.clone(),
                admitted_at,
            })?;

        match outcome {
            SubagentWakeTurnPersistenceOutcome::Admitted => {
                self.next_seq = staged_next_seq;
                self.current_turn_id = Some(turn_id.clone());
                self.engine_initiated_turn = false;
                self.engine_turn_has_events = false;
                self.turn_assistant_messages.clear();
                for envelope in events {
                    record_transcript_phase_event(&mut self.transcript_phase_debug, &envelope);
                    let _ = self.event_tx.send(envelope);
                }
                Ok(SubagentWakeTurnStartOutcome::Admitted { turn_id })
            }
            SubagentWakeTurnPersistenceOutcome::AlreadyVisible { .. } => {
                Ok(SubagentWakeTurnStartOutcome::AlreadyVisible)
            }
            SubagentWakeTurnPersistenceOutcome::Discarded => {
                Ok(SubagentWakeTurnStartOutcome::Discarded)
            }
            SubagentWakeTurnPersistenceOutcome::Stale => Ok(SubagentWakeTurnStartOutcome::Stale),
        }
    }
}
