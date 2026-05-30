use std::sync::Arc;

use anyharness_contract::v1::{SubagentTurnCompletedPayload, SubagentTurnOutcome};
use uuid::Uuid;

use super::model::SubagentCompletionRecord;
use super::service::SubagentService;
use crate::live::sessions::LiveSessionManager;
use crate::sessions::extensions::{
    SessionExtension, SessionTurnFinishedContext, SessionTurnOutcome,
};
use crate::sessions::prompt::{PromptPayload, PromptProvenance};
use crate::sessions::runtime_event::RuntimeInjectedSessionEvent;
use crate::sessions::store::SessionStore;

#[derive(Clone)]
pub struct SubagentSessionHooks {
    service: Arc<SubagentService>,
    acp_manager: LiveSessionManager,
    session_store: SessionStore,
}

impl SubagentSessionHooks {
    pub fn new(
        service: Arc<SubagentService>,
        acp_manager: LiveSessionManager,
        session_store: SessionStore,
    ) -> Self {
        Self {
            service,
            acp_manager,
            session_store,
        }
    }
}

impl SessionExtension for SubagentSessionHooks {
    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        let service = self.service.clone();
        let acp_manager = self.acp_manager.clone();
        let session_store = self.session_store.clone();
        tokio::spawn(async move {
            if let Err(error) =
                deliver_subagent_completion(service, acp_manager, session_store, ctx).await
            {
                tracing::warn!(error = %error, "failed to process subagent completion");
            }
        });
    }
}

async fn deliver_subagent_completion(
    service: Arc<SubagentService>,
    acp_manager: LiveSessionManager,
    session_store: SessionStore,
    ctx: SessionTurnFinishedContext,
) -> anyhow::Result<()> {
    if ctx.turn_id.trim().is_empty() {
        return Ok(());
    }
    let Some(link) = service.find_subagent_parent(&ctx.session_id)? else {
        return Ok(());
    };

    let now = chrono::Utc::now().to_rfc3339();
    let completion = SubagentCompletionRecord {
        completion_id: Uuid::new_v4().to_string(),
        session_link_id: link.id.clone(),
        child_turn_id: ctx.turn_id.clone(),
        child_last_event_seq: ctx.last_event_seq,
        outcome: ctx.outcome,
        parent_event_seq: None,
        parent_prompt_seq: None,
        created_at: now.clone(),
        updated_at: now,
    };
    let prompt = wake_prompt_text(
        link.label.as_deref(),
        link.public_id.as_deref(),
        ctx.outcome,
    );
    let prompt_payload =
        PromptPayload::text(prompt).with_provenance(PromptProvenance::SubagentWake {
            session_link_id: link.id.clone(),
            completion_id: completion.completion_id.clone(),
            label: link.label.clone(),
        });
    let Some(inserted) = service.insert_completion_and_consume_schedule(
        &completion,
        &link.parent_session_id,
        &prompt_payload,
    )?
    else {
        return Ok(());
    };

    let payload = SubagentTurnCompletedPayload {
        completion_id: inserted.completion.completion_id.clone(),
        session_link_id: link.id.clone(),
        parent_session_id: link.parent_session_id.clone(),
        child_session_id: link.child_session_id.clone(),
        child_turn_id: ctx.turn_id.clone(),
        child_last_event_seq: ctx.last_event_seq,
        outcome: to_contract_outcome(ctx.outcome),
        label: link.label.clone(),
    };
    match acp_manager
        .emit_runtime_event(
            &link.parent_session_id,
            session_store.clone(),
            RuntimeInjectedSessionEvent::SubagentTurnCompleted(payload),
        )
        .await
    {
        Ok(envelope) => {
            let _ = service.mark_parent_event_seq(&inserted.completion.completion_id, envelope.seq);
        }
        Err(error) => {
            tracing::warn!(
                parent_session_id = %link.parent_session_id,
                child_session_id = %link.child_session_id,
                completion_id = %inserted.completion.completion_id,
                error = %error,
                "failed to inject subagent turn event"
            );
        }
    }

    if let (Some(record), Some(handle)) = (
        inserted.wake_prompt.as_ref(),
        acp_manager.get_handle(&link.parent_session_id).await,
    ) {
        let _ = handle
            .send_queued_prompt(prompt_payload, record.seq)
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
    }
    Ok(())
}

fn to_contract_outcome(outcome: SessionTurnOutcome) -> SubagentTurnOutcome {
    match outcome {
        SessionTurnOutcome::Completed => SubagentTurnOutcome::Completed,
        SessionTurnOutcome::Failed => SubagentTurnOutcome::Failed,
        SessionTurnOutcome::Cancelled => SubagentTurnOutcome::Cancelled,
    }
}

fn wake_prompt_text(
    label: Option<&str>,
    subagent_id: Option<&str>,
    outcome: SessionTurnOutcome,
) -> String {
    let label = label.unwrap_or("subagent");
    let subagent_id = subagent_id.unwrap_or("unknown");
    format!(
        "Subagent \"{label}\" completed a turn.\n\nsubagentId: {subagent_id}\nOutcome: {}\n\nUse read_subagent_latest_turns or search_subagent_transcript with this subagentId before relying on the result.",
        outcome.as_str()
    )
}
