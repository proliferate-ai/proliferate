use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{PendingPromptRemovalReason, PendingPromptRemovedPayload};
use tokio::sync::Mutex;

use crate::domains::sessions::model::PromptAttachmentState;
use crate::domains::sessions::prompt::render::{render, TurnPromptExtras};
use crate::domains::sessions::prompt::PromptPayload;
use crate::live::sessions::actor::command::PromptAcceptError;
use crate::live::sessions::actor::state::SessionActorConfig;
use crate::live::sessions::actor::turn::handle::first_prompt_system_prompt_append_for_codex_prompt;
use crate::live::sessions::sink::SessionEventSink;

pub(in crate::live::sessions::actor) struct StartedPromptTurn {
    pub acp_blocks: Vec<acp::schema::ContentBlock>,
    pub turn_id: String,
}

pub(in crate::live::sessions::actor) async fn begin_prompt_turn(
    config: &SessionActorConfig,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    source_agent_kind: &str,
    payload: &PromptPayload,
    prompt_id: Option<String>,
    queue_seq: Option<i64>,
) -> Result<StartedPromptTurn, PromptAcceptError> {
    // Resolve: load every referenced attachment (store rows + stored bytes,
    // legacy-content fallback included) through the attachments capability.
    let parts = match config.caps.attachments.load(session_id, payload) {
        Ok(parts) => parts,
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                code = error.code,
                detail = %error.detail,
                "failed to build ACP prompt blocks",
            );
            return Err(PromptAcceptError::EnqueueFailed(error.detail));
        }
    };

    // Decide the codex first-prompt append. The durable turn-history gate
    // stays exactly here: it needs the events capability, so the decision
    // happens before the pure render and rides in as an extra.
    let mut first_prompt_system_prompt_append = None;
    match config.caps.events.has_turn_started_event(session_id) {
        Ok(has_turn_started) => {
            first_prompt_system_prompt_append = first_prompt_system_prompt_append_for_codex_prompt(
                source_agent_kind,
                config.launch.prompts.first_prompt.as_deref(),
                has_turn_started,
            )
            .map(str::to_string);
        }
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to determine whether prompt should inline system prompt append"
            );
        }
    }

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
                session_id = %session_id,
                code = error.code,
                detail = %error.detail,
                "failed to build ACP prompt blocks",
            );
            return Err(PromptAcceptError::EnqueueFailed(error.detail));
        }
    };

    // Effects: begin_turn durably persists the replacement turn events first;
    // attachment hygiene and the queue-row removal follow in the same order
    // as before, all under one sink lock hold.
    let turn_id;
    {
        let mut sink = event_sink.lock().await;
        let content_parts = payload.content_parts();
        turn_id = sink.begin_turn(
            payload.text_summary.clone(),
            prompt_id.clone(),
            content_parts,
            payload.public_provenance(),
        );
        if let Err(error) = config.caps.attachments.mark_prompt_attachments_state(
            session_id,
            &payload.attachment_ids(),
            PromptAttachmentState::Transcript,
        ) {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to mark prompt attachments as transcript",
            );
        }
        // Invariant: delete a drained queue row and emit Removed only after
        // begin_turn has durably persisted the replacement turn events.
        if let Some(seq) = queue_seq {
            if let Err(error) = config.caps.queue.delete_pending_prompt(session_id, seq) {
                tracing::warn!(
                    session_id = %session_id,
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

    Ok(StartedPromptTurn {
        acp_blocks,
        turn_id,
    })
}
