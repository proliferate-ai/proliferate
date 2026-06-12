use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{PendingPromptRemovalReason, PendingPromptRemovedPayload};
use tokio::sync::Mutex;

use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::model::PromptAttachmentState;
use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::store::SessionStore;
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
    store: &SessionStore,
    attachment_storage: &PromptAttachmentStorage,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    source_agent_kind: &str,
    payload: &PromptPayload,
    prompt_id: Option<String>,
    queue_seq: Option<i64>,
) -> Result<StartedPromptTurn, PromptAcceptError> {
    let mut acp_blocks = match payload.to_acp_blocks(store, attachment_storage, session_id) {
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

    match store.has_turn_started_event(session_id) {
        Ok(has_turn_started) => {
            if let Some(append) = first_prompt_system_prompt_append_for_codex_prompt(
                source_agent_kind,
                config.first_prompt_system_prompt_append.as_deref(),
                has_turn_started,
            ) {
                prepend_system_prompt_append_to_acp_blocks(&mut acp_blocks, append);
            }
        }
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to determine whether prompt should inline system prompt append"
            );
        }
    }

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
        if let Err(error) = store.mark_prompt_attachments_state(
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
            if let Err(error) = store.delete_pending_prompt(session_id, seq) {
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

pub(in crate::live::sessions::actor) fn prepend_system_prompt_append_to_acp_blocks(
    blocks: &mut Vec<acp::schema::ContentBlock>,
    append: &str,
) {
    blocks.insert(
        0,
        acp::schema::ContentBlock::Text(acp::schema::TextContent::new(format!(
            "System instruction from AnyHarness, not user content:\n{append}"
        ))),
    );
}
