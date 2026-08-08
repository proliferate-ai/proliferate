//! Arming and consuming session-scoped wakes.
//!
//! Arming is one gated insert. Consumption is one transaction, run from the
//! turn-finish hook: delete every schedule watching the finished session and
//! queue one pointer per deleted watcher. Because consumption happens at turn
//! finish rather than at arm time, a schedule armed while the target's turn was
//! already running still fires at the end of THAT turn — ruling 10 falls out of
//! the design instead of needing a race check.

use crate::domains::sessions::authorize::{authorize, AgentAccessError, AgentAccessIntent};
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::prompt::envelope::{agent_wake, AgentWakePointer};
use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::store::agent_wakes::ConsumedAgentWake;
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
}

impl AgentWakeService {
    pub fn new(session_store: SessionStore) -> Self {
        Self { session_store }
    }

    pub fn session_store(&self) -> &SessionStore {
        &self.session_store
    }

    /// Arm `watcher` on `target`. Gated on `Send` intent: a wake reaches into
    /// the watcher's own queue later, but only a session that can still be
    /// waited on is worth waiting on — a closed target never finishes another
    /// turn, so arming on one is a refusal, not a schedule that silently never
    /// fires.
    pub fn arm(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
    ) -> Result<ArmedAgentWake, AgentAccessError> {
        let access = authorize(
            &self.session_store,
            watcher_session_id,
            target_session_id,
            AgentAccessIntent::Send,
        )?;
        if access.caller.id == access.target.id {
            return Err(AgentAccessError::Internal(anyhow::anyhow!(
                "a session cannot schedule a wake on itself"
            )));
        }
        let created = self
            .session_store
            .arm_agent_wake(&access.caller.id, &access.target.id)?;
        Ok(ArmedAgentWake {
            watcher_session_id: access.caller.id,
            target: access.target,
            created,
        })
    }

    /// Drop one schedule without firing it. Two callers: a real reply, which
    /// already delivered everything the pointer would have pointed at, and the
    /// compensation path when the send an arm rode along with then failed.
    pub fn disarm(
        &self,
        watcher_session_id: &str,
        target_session_id: &str,
    ) -> anyhow::Result<bool> {
        self.session_store
            .delete_agent_wake(watcher_session_id, target_session_id)
    }

    /// The turn-finish half. One transaction consumes every schedule watching
    /// `target` and queues its pointer; what comes back is what to hand to any
    /// watcher that happens to be live.
    pub fn consume_for_finished_turn(
        &self,
        target_session_id: &str,
        outcome: SessionTurnOutcome,
    ) -> anyhow::Result<Vec<FiredAgentWake>> {
        // Nothing to build a pointer from if the target is gone; the schedules
        // would have gone with it.
        let Some(target) = self.session_store.find_by_id(target_session_id)? else {
            return Ok(Vec::new());
        };
        let payload = agent_wake(AgentWakePointer::for_session(&target, outcome)).into_payload();
        let consumed = self
            .session_store
            .consume_agent_wakes_for_target(&target.id, &payload)?;
        Ok(consumed
            .into_iter()
            .map(|consumed| FiredAgentWake {
                consumed,
                payload: payload.clone(),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
    use crate::persistence::Db;

    fn session_record(id: &str, title: Option<&str>) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: title.map(ToString::to_string),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-08-08T00:00:00Z".to_string(),
            updated_at: "2026-08-08T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn service_fixture() -> AgentWakeService {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        let store = SessionStore::new(db);
        store
            .insert(&session_record("ses_watcher", Some("Deploy Checker")))
            .expect("insert watcher");
        store
            .insert(&session_record("ses_target", Some("Schema audit")))
            .expect("insert target");
        AgentWakeService::new(store)
    }

    #[test]
    fn arming_twice_is_one_schedule_and_one_wake() {
        let service = service_fixture();

        assert!(
            service
                .arm("ses_watcher", "ses_target")
                .expect("arm")
                .created
        );
        assert!(
            !service
                .arm("ses_watcher", "ses_target")
                .expect("arm again")
                .created
        );

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .expect("consume");

        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].consumed.watcher_session_id, "ses_watcher");
    }

    #[test]
    fn a_consumed_schedule_does_not_fire_again_on_the_next_turn() {
        let service = service_fixture();
        service.arm("ses_watcher", "ses_target").expect("arm");

        let first = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .expect("first turn");
        let second = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .expect("second turn");

        assert_eq!(first.len(), 1);
        assert!(second.is_empty());
    }

    #[test]
    fn a_schedule_armed_mid_turn_fires_at_that_turns_end() {
        // The target's turn is already running when the watcher arms. Nothing
        // records "when the turn started", so this is the whole of ruling 10:
        // the row exists by the time the turn finishes, so it fires.
        let service = service_fixture();
        service
            .session_store()
            .update_status("ses_target", "running", "2026-08-08T00:01:00Z")
            .expect("target is mid-turn");

        service
            .arm("ses_watcher", "ses_target")
            .expect("arm mid-turn");
        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .expect("the running turn finishes");

        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].consumed.watcher_session_id, "ses_watcher");
    }

    #[test]
    fn every_watcher_of_one_target_gets_its_own_pointer() {
        let service = service_fixture();
        service
            .session_store()
            .insert(&session_record("ses_watcher_2", Some("Release notes")))
            .expect("insert second watcher");
        service.arm("ses_watcher", "ses_target").expect("arm");
        service.arm("ses_watcher_2", "ses_target").expect("arm");

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .expect("consume");

        let mut watchers = fired
            .iter()
            .map(|fired| fired.consumed.watcher_session_id.as_str())
            .collect::<Vec<_>>();
        watchers.sort_unstable();
        assert_eq!(watchers, ["ses_watcher", "ses_watcher_2"]);
        for fired in &fired {
            assert_eq!(
                fired.consumed.wake_prompt.session_id,
                fired.consumed.watcher_session_id
            );
        }
    }

    #[test]
    fn the_queued_pointer_is_the_envelope_text_and_carries_the_outcome() {
        let service = service_fixture();
        service.arm("ses_watcher", "ses_target").expect("arm");

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Failed)
            .expect("consume");

        let queued = &fired[0].consumed.wake_prompt;
        assert_eq!(
            queued.text,
            "Agent \"Schema audit\" (session ses_target) completed a turn. Outcome: failed.\n\nUse read_agent_transcript with sessionId \"ses_target\" for the result, or send_agent_message to follow up."
        );
        assert_eq!(queued.text, fired[0].payload.text_summary);
        // The durable row is what wakes an offline watcher; the payload is only
        // what a live one is handed directly.
        let pending = service
            .session_store()
            .list_pending_prompts("ses_watcher")
            .expect("pending prompts");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].seq, queued.seq);
        assert_eq!(pending[0].text, queued.text);
    }

    #[test]
    fn a_closed_target_cannot_be_waited_on() {
        let service = service_fixture();
        let mut closed = session_record("ses_closed", Some("Retired"));
        closed.closed_at = Some("2026-08-08T01:00:00Z".to_string());
        closed.status = "closed".to_string();
        service
            .session_store()
            .insert(&closed)
            .expect("insert closed target");

        let error = service
            .arm("ses_watcher", "ses_closed")
            .err()
            .expect("closed target is rejected");

        assert!(matches!(error, AgentAccessError::TargetClosed));
        assert!(service
            .session_store()
            .list_agent_wakes_for_target("ses_closed")
            .expect("list schedules")
            .is_empty());
    }

    #[test]
    fn an_unknown_target_is_rejected_and_arms_nothing() {
        let service = service_fixture();

        let error = service
            .arm("ses_watcher", "ses_ghost")
            .err()
            .expect("unknown target is rejected");

        assert!(matches!(error, AgentAccessError::TargetNotFound(ref id) if id == "ses_ghost"));
        assert!(service
            .session_store()
            .list_agent_wakes_for_watcher("ses_watcher")
            .expect("list schedules")
            .is_empty());
    }

    #[test]
    fn a_session_cannot_wait_on_itself() {
        let service = service_fixture();

        let error = service
            .arm("ses_watcher", "ses_watcher")
            .err()
            .expect("self-wake is rejected");

        assert!(matches!(error, AgentAccessError::Internal(_)));
    }

    #[test]
    fn disarming_removes_the_schedule_so_the_turn_end_wakes_nobody() {
        let service = service_fixture();
        service.arm("ses_watcher", "ses_target").expect("arm");

        assert!(service.disarm("ses_watcher", "ses_target").expect("disarm"));
        assert!(!service
            .disarm("ses_watcher", "ses_target")
            .expect("disarm again"));

        assert!(service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .expect("consume")
            .is_empty());
        assert!(service
            .session_store()
            .list_pending_prompts("ses_watcher")
            .expect("pending prompts")
            .is_empty());
    }

    #[test]
    fn an_unwatched_targets_turn_queues_nothing() {
        let service = service_fixture();

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .expect("consume");

        assert!(fired.is_empty());
        assert!(service
            .session_store()
            .list_pending_prompts("ses_watcher")
            .expect("pending prompts")
            .is_empty());
    }
}
