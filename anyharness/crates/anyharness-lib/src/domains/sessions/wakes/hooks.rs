//! The turn-finish half of session-scoped wakes.
//!
//! This runs for EVERY session that finishes a turn, not only for delegating
//! ones: any session can be the target of a wake, so the finished session is
//! always asked whether anyone was watching it.

use std::sync::Arc;

use super::service::AgentWakeService;
use crate::domains::sessions::extensions::{SessionExtension, SessionTurnFinishedContext};
use crate::live::sessions::LiveSessionManager;

#[derive(Clone)]
pub struct AgentWakeSessionHooks {
    service: Arc<AgentWakeService>,
    acp_manager: LiveSessionManager,
}

impl AgentWakeSessionHooks {
    pub fn new(service: Arc<AgentWakeService>, acp_manager: LiveSessionManager) -> Self {
        Self {
            service,
            acp_manager,
        }
    }
}

impl SessionExtension for AgentWakeSessionHooks {
    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        let service = self.service.clone();
        let acp_manager = self.acp_manager.clone();
        tokio::spawn(async move {
            if let Err(error) = deliver_agent_wakes(service, acp_manager, ctx).await {
                tracing::warn!(error = %error, "failed to fire session-scoped agent wakes");
            }
        });
    }
}

// Spec 2b classification (admission:derived-safe): the pointer is queued by the
// same transaction that consumes the schedule, and the watcher is whoever armed
// it — the wake takes no admission permit. A watcher a workflow controls is not
// prompted at all: the consume path filters it with a read-only controller
// lookup and leaves its schedule armed
// (`wakes::service::consume_for_finished_turn`). Threading a permit here instead
// would wait on the actor callback context, which the spec forbids.
//
// No turn-id guard, deliberately. A session-scoped schedule is keyed on the
// session pair and records nothing about which turn it fires for, so an empty
// `turn_id` — the actor's connection failing before the turn ever opened — is
// still a finished turn from the watcher's side, and the pointer carries the
// outcome ("Outcome: failed") that says so. The link-scoped hook next door DOES
// need the guard, because it writes `child_turn_id` into a completion row.
// The honest limit: this fires from the actor's finish path, so a runtime that
// dies mid-turn without reaching it consumes nothing and the schedule stays
// armed for the target's next finished turn.
async fn deliver_agent_wakes(
    service: Arc<AgentWakeService>,
    acp_manager: LiveSessionManager,
    ctx: SessionTurnFinishedContext,
) -> anyhow::Result<()> {
    let fired = service
        .consume_for_finished_turn(&ctx.session_id, ctx.outcome)
        .await?;
    for fired in fired {
        // Every consumed schedule already has its durable pending-prompt row.
        // Handing it to a live watcher is the fast path, not the delivery
        // guarantee: an offline watcher drains the same row when it next runs.
        let Some(handle) = acp_manager
            .get_handle(&fired.consumed.watcher_session_id)
            .await
        else {
            continue;
        };
        if let Err(error) = handle
            .send_queued_prompt(fired.payload, fired.consumed.wake_prompt.seq)
            .await
        {
            tracing::warn!(
                watcher_session_id = %fired.consumed.watcher_session_id,
                target_session_id = %ctx.session_id,
                error = ?error,
                "failed to hand a queued agent wake pointer to a live watcher"
            );
        }
    }
    Ok(())
}
