use agent_client_protocol as acp;
use anyharness_contract::v1::{PendingPromptRemovalReason, PendingPromptRemovedPayload};

use crate::domains::agents::model::AgentKind;
use crate::domains::sessions::model::PromptAttachmentState;
use crate::domains::sessions::prompt::render::{render, TurnPromptExtras};
use crate::domains::sessions::prompt::{PromptPayload, ResolvedParts};
use crate::live::sessions::actor::command::PromptAcceptError;
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::sink::SubagentWakeTurnStartOutcome;

pub(in crate::live::sessions::actor) struct StartedPromptTurn {
    pub acp_blocks: Vec<acp::schema::ContentBlock>,
    pub turn_id: String,
}

pub(in crate::live::sessions::actor) enum BeginPromptTurnOutcome {
    Started(StartedPromptTurn),
    Skipped(SubagentWakeTurnStartOutcome),
}

impl SessionActor {
    pub(in crate::live::sessions::actor) async fn begin_prompt_turn(
        &self,
        payload: &PromptPayload,
        prompt_id: Option<String>,
        queue_seq: Option<i64>,
    ) -> Result<BeginPromptTurnOutcome, PromptAcceptError> {
        // Decide the codex first-prompt append. The durable turn-history gate
        // stays exactly here: it needs the events capability, so the decision
        // happens before admission/render and rides in as an extra.
        let mut first_prompt_system_prompt_append = None;
        match self.caps.events.has_turn_started_event(&self.session_id) {
            Ok(has_turn_started) => {
                first_prompt_system_prompt_append =
                    first_prompt_system_prompt_append_for_codex_prompt(
                        &self.agent_kind,
                        self.prompts.first_prompt.as_deref(),
                        has_turn_started,
                    )
                    .map(str::to_string);
            }
            Err(error) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    error = %error,
                    "failed to determine whether prompt should inline system prompt append"
                );
            }
        }

        // A queued completion wake reaches durable validation before any
        // attachment lookup. Canonical wakes are exactly one text block, so a
        // forged internal row with an extra/missing attachment is discarded
        // rather than becoming an attachment-resolution retry loop.
        let admitted_subagent_turn =
            if let Some(seq) = queue_seq.filter(|_| payload.has_subagent_wake_provenance()) {
                let mut sink = self.event_sink.lock().await;
                let outcome = sink
                    .persist_subagent_wake_turn(
                        payload.text_summary.clone(),
                        prompt_id.clone(),
                        payload.content_parts(),
                        payload.public_provenance(),
                        seq,
                    )
                    .map_err(|error| PromptAcceptError::EnqueueFailed(error.to_string()))?;
                match outcome {
                    SubagentWakeTurnStartOutcome::Admitted { turn_id } => Some(turn_id),
                    other => return Ok(BeginPromptTurnOutcome::Skipped(other)),
                }
            } else {
                None
            };

        // Admission proves that a completion wake has no attachment-bearing
        // blocks. Ordinary prompts retain the existing attachment loader.
        let parts = if admitted_subagent_turn.is_some() {
            ResolvedParts::default()
        } else {
            match self.caps.attachments.load(&self.session_id, payload) {
                Ok(parts) => parts,
                Err(error) => {
                    tracing::warn!(
                        session_id = %self.session_id,
                        code = error.code,
                        detail = %error.detail,
                        "failed to build ACP prompt blocks",
                    );
                    return Err(PromptAcceptError::EnqueueFailed(error.detail));
                }
            }
        };

        // Render: pure payload + loaded parts -> ACP blocks; the first-prompt
        // append folds in here instead of mutating the blocks afterwards.
        let acp_blocks = match render(
            payload,
            &parts,
            &TurnPromptExtras {
                first_prompt_system_prompt_append,
            },
        ) {
            Ok(blocks) => blocks,
            Err(error) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    code = error.code,
                    detail = %error.detail,
                    "failed to build ACP prompt blocks",
                );
                return Err(PromptAcceptError::EnqueueFailed(error.detail));
            }
        };

        if let Some(turn_id) = admitted_subagent_turn {
            return Ok(BeginPromptTurnOutcome::Started(StartedPromptTurn {
                acp_blocks,
                turn_id,
            }));
        }

        // Effects: begin_turn durably persists the replacement turn events first;
        // attachment hygiene and the queue-row removal follow in the same order
        // as before, all under one sink lock hold.
        let turn_id;
        {
            let mut sink = self.event_sink.lock().await;
            let content_parts = payload.content_parts();
            turn_id = sink
                .begin_turn(
                    payload.text_summary.clone(),
                    prompt_id.clone(),
                    content_parts,
                    payload.public_provenance(),
                )
                .map_err(|_| {
                    PromptAcceptError::EnqueueFailed(
                        "prior turn could not be durably finalized".to_string(),
                    )
                })?;
            if let Err(error) = self.caps.attachments.mark_prompt_attachments_state(
                &self.session_id,
                &payload.attachment_ids(),
                PromptAttachmentState::Transcript,
            ) {
                tracing::warn!(
                    session_id = %self.session_id,
                    error = %error,
                    "failed to mark prompt attachments as transcript",
                );
            }
            // Invariant: delete a drained queue row and emit Removed only after
            // begin_turn has durably persisted the replacement turn events.
            if let Some(seq) = queue_seq {
                if let Err(error) = self.caps.queue.delete_pending_prompt(&self.session_id, seq) {
                    tracing::warn!(
                        session_id = %self.session_id,
                        seq,
                        error = %error,
                        "failed to delete pending prompt after begin_turn",
                    );
                }
                sink.pending_prompt_removed(PendingPromptRemovedPayload {
                    seq,
                    prompt_id,
                    reason: PendingPromptRemovalReason::Executed,
                });
            }
        }

        Ok(BeginPromptTurnOutcome::Started(StartedPromptTurn {
            acp_blocks,
            turn_id,
        }))
    }
}

/// Codex inlines its first-prompt system append as a leading text block; all
/// other harnesses (and every later turn) receive nothing here.
pub(in crate::live::sessions::actor) fn first_prompt_system_prompt_append_for_codex_prompt<'a>(
    source_agent_kind: &str,
    first_prompt_system_prompt_append: Option<&'a str>,
    has_turn_started: bool,
) -> Option<&'a str> {
    if source_agent_kind != AgentKind::Codex.as_str() || has_turn_started {
        return None;
    }

    let append = first_prompt_system_prompt_append?.trim();
    if append.is_empty() {
        return None;
    }
    Some(append)
}
