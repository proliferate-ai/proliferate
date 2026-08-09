//! Arming and consuming session-scoped wakes.
//!
//! Arming is one gated insert. Consumption is one transaction, run from the
//! turn-finish hook: delete every schedule watching the finished session and
//! queue one pointer per deleted watcher. Because consumption happens at turn
//! finish rather than at arm time, a schedule armed while the target's turn was
//! already running still fires at the end of THAT turn (ruling 10). What ruling
//! 10 does NOT promise is liveness: a wake fires at the end of the target's next
//! FINISHED turn, so an idle target that is never prompted again fires nothing.
//! `schedule_agent_wake` reports the target's live status for exactly that
//! reason.
//!
//! Two watchers are treated specially at consume time, both for the same
//! reason — a pointer is a PROMPT, and the prompt paths have rules:
//! - a workflow-controlled watcher is skipped and its schedule left ARMED, so
//!   the wake lands after the run releases control rather than being injected
//!   into a session every other prompt path 409s (`peer_ops::admit_peer_mutation`).
//!   The controller lookup is a pure read: no permit, no lease, no new edge in
//!   the canonical `permit -> operation lease` order (PR1227-LOCK-01).
//! - a closed watcher's schedule is dropped without a pointer (ruling 6: a
//!   closed session takes no input).

use std::collections::HashSet;
use std::sync::Arc;

use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::authorize::{
    authorize, is_closed, AgentAccessError, AgentAccessIntent,
};
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::prompt::envelope::{agent_wake, AgentWakePointer};
use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::store::agent_wakes::{AgentWakeReason, ConsumedAgentWake};
use crate::domains::sessions::store::SessionStore;

#[derive(Debug, Clone)]
pub struct ArmedAgentWake {
    pub watcher_session_id: String,
    pub target: SessionRecord,
    /// `false` when the pair was already armed. The pair primary key makes a
    /// double arm a no-op rather than a second wake.
    pub created: bool,
}

/// One consumed schedule, with the target it was watching resolved for the
/// caller that has to hand the queued prompt to a live watcher.
#[derive(Debug, Clone)]
pub struct FiredAgentWake {
    pub consumed: ConsumedAgentWake,
    pub payload: PromptPayload,
}

#[derive(Clone)]
pub struct AgentWakeService {
    session_store: SessionStore,
    admission: Arc<SessionMutationAdmission>,
}

impl AgentWakeService {
    pub fn new(session_store: SessionStore, admission: Arc<SessionMutationAdmission>) -> Self {
        Self {
            session_store,
            admission,
        }
    }

    pub fn session_store(&self) -> &SessionStore {
        &self.session_store
    }

    /// Arm `watcher` on `target`. Gated on `Send` intent: a wake reaches into
    /// the watcher's own queue later, but only a session that can still be
    /// waited on is worth waiting on — a closed target never finishes another
    /// turn, so arming on one is a refusal, not a schedule that silently never
    /// fires.
    ///
    /// `reason` records what may consume the row before the target's turn
    /// finishes; re-arming an existing pair keeps the stronger reason
    /// (`SessionStore::arm_agent_wake`).
    pub fn arm(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
        reason: AgentWakeReason,
    ) -> Result<ArmedAgentWake, AgentAccessError> {
        let access = authorize(
            &self.session_store,
            watcher_session_id,
            target_session_id,
            AgentAccessIntent::Send,
        )?;
        let created =
            self.session_store
                .arm_agent_wake(&access.caller.id, &access.target.id, reason)?;
        Ok(ArmedAgentWake {
            watcher_session_id: access.caller.id,
            target: access.target,
            created,
        })
    }

    /// A real reply already delivered everything the pointer would have pointed
    /// at, so the schedule it was the safety net for comes off instead of
    /// firing. Only a REPLY arm is consumed: an explicit `schedule_agent_wake`
    /// is a standing request that survives an incidental message.
    pub fn consume_reply_arm(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
    ) -> anyhow::Result<bool> {
        self.session_store
            .consume_reply_agent_wake(watcher_session_id, target_session_id)
    }

    /// Record that the send this reply arm rode along with landed, so a
    /// parallel send's failure compensation can no longer remove it.
    pub fn confirm_reply_arm_dispatch(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
    ) -> anyhow::Result<bool> {
        self.session_store
            .confirm_agent_wake_dispatch(watcher_session_id, target_session_id)
    }

    /// Compensate a reply arm whose send then failed — but only while no landed
    /// send relies on it.
    pub fn discard_unconfirmed_reply_arm(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
    ) -> anyhow::Result<bool> {
        self.session_store
            .delete_unconfirmed_reply_agent_wake(watcher_session_id, target_session_id)
    }

    /// The turn-finish half. One transaction consumes every schedule watching
    /// `target` and queues its pointer; what comes back is what to hand to any
    /// watcher that happens to be live.
    pub async fn consume_for_finished_turn(
        &self,
        target_session_id: &str,
        outcome: SessionTurnOutcome,
    ) -> anyhow::Result<Vec<FiredAgentWake>> {
        // Nothing to build a pointer from if the target is gone; the schedules
        // would have gone with it.
        let Some(target) = self.session_store.find_by_id(target_session_id)? else {
            return Ok(Vec::new());
        };
        // A closed target will not finish another turn, so nothing can ever
        // consume its schedules. This is the close-detection point this layer
        // can reach; session deletion already clears both sides.
        if is_closed(&target) {
            let cleared = self
                .session_store
                .delete_agent_wakes_for_target(&target.id)?;
            if cleared > 0 {
                tracing::info!(
                    target_session_id = %target.id,
                    cleared,
                    "cleared session-scoped wake schedules watching a closed target"
                );
            }
            return Ok(Vec::new());
        }
        let controlled = self.controlled_watchers_of(&target.id).await?;
        let payload = agent_wake(AgentWakePointer::for_session(&target, outcome)).into_payload();
        let consumption =
            self.session_store
                .consume_agent_wakes_for_target(&target.id, &payload, &controlled)?;
        if !consumption.left_armed_controlled_watchers.is_empty() {
            tracing::info!(
                target_session_id = %target.id,
                watchers = ?consumption.left_armed_controlled_watchers,
                "left session-scoped wake schedules armed: a workflow controls the watcher"
            );
        }
        if !consumption.dropped_closed_watchers.is_empty() {
            tracing::info!(
                target_session_id = %target.id,
                watchers = ?consumption.dropped_closed_watchers,
                "dropped session-scoped wake schedules: the watcher is closed"
            );
        }
        Ok(consumption
            .fired
            .into_iter()
            .map(|consumed| FiredAgentWake {
                consumed,
                payload: payload.clone(),
            })
            .collect())
    }

    /// Which of the target's watchers a nonterminal workflow controls. Pure
    /// read-only controller lookup, run BEFORE the consume transaction opens:
    /// it takes no permit and no lease, exactly like the workspace-destruction
    /// re-check it borrows from.
    async fn controlled_watchers_of(
        &self,
        target_session_id: &str,
    ) -> anyhow::Result<HashSet<String>> {
        let watchers: Vec<String> = self
            .session_store
            .list_agent_wakes_for_target(target_session_id)?
            .into_iter()
            .map(|schedule| schedule.watcher_session_id)
            .collect();
        if watchers.is_empty() {
            return Ok(HashSet::new());
        }
        self.admission.workflow_controlled_sessions(watchers).await
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
