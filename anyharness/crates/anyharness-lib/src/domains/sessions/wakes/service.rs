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
mod tests {
    use super::*;
    use crate::app::test_support;
    use crate::domains::sessions::admission::{NoControllerPolicy, SessionControllerPolicy};
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
        AgentWakeService::new(store, uncontrolled_admission())
    }

    fn uncontrolled_admission() -> Arc<SessionMutationAdmission> {
        Arc::new(SessionMutationAdmission::new(Arc::new(NoControllerPolicy)))
    }

    /// A controller policy that hands one session to one run — the durable
    /// lookup the Workflows domain implements in production.
    struct ControlledSession {
        session_id: &'static str,
    }

    impl SessionControllerPolicy for ControlledSession {
        fn controlling_run_id(&self, session_id: &str) -> anyhow::Result<Option<String>> {
            Ok((session_id == self.session_id).then(|| "run_7".to_string()))
        }
    }

    fn close_session(service: &AgentWakeService, session_id: &str) {
        service
            .session_store()
            .update_status(session_id, "closed", "2026-08-08T02:00:00Z")
            .expect("mark closed");
        service
            .session_store()
            .mark_closed(session_id, "2026-08-08T02:00:00Z")
            .expect("stamp closed_at");
    }

    #[tokio::test]
    async fn arming_twice_is_one_schedule_and_one_wake() {
        let service = service_fixture();

        assert!(
            service
                .arm(
                    "ses_watcher",
                    "ses_target",
                    AgentWakeReason::ExplicitSchedule
                )
                .expect("arm")
                .created
        );
        assert!(
            !service
                .arm(
                    "ses_watcher",
                    "ses_target",
                    AgentWakeReason::ExplicitSchedule
                )
                .expect("arm again")
                .created
        );

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("consume");

        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].consumed.watcher_session_id, "ses_watcher");
    }

    #[tokio::test]
    async fn a_consumed_schedule_does_not_fire_again_on_the_next_turn() {
        let service = service_fixture();
        service
            .arm(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");

        let first = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("first turn");
        let second = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("second turn");

        assert_eq!(first.len(), 1);
        assert!(second.is_empty());
    }

    #[tokio::test]
    async fn consumption_keys_on_the_row_existing_at_turn_finish_and_nothing_else() {
        // Ruling 10 in full. Nothing anywhere records when a turn STARTED, so
        // "covers the current turn" is not a comparison — it is the absence of
        // one: consumption runs at turn finish and takes whatever rows exist
        // then, whatever the target's live status happens to say. This pins
        // both halves: a schedule armed while the target is mid-turn fires at
        // that turn's end, and the status the row was armed under is never
        // read. (An earlier version set the status to "running" and asserted
        // nothing about it, which proved only the ordinary path.)
        let service = service_fixture();
        service
            .session_store()
            .update_status("ses_target", "running", "2026-08-08T00:01:00Z")
            .expect("target is mid-turn");

        service
            .arm(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm mid-turn");
        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("the running turn finishes");

        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].consumed.watcher_session_id, "ses_watcher");
        assert_eq!(
            service
                .session_store()
                .find_by_id("ses_target")
                .expect("target")
                .expect("target exists")
                .status,
            "running",
            "consumption must not depend on the target's status having settled"
        );

        // The mirror: armed while the target is idle, it fires at the next
        // finished turn just the same.
        service
            .session_store()
            .update_status("ses_target", "idle", "2026-08-08T00:02:00Z")
            .expect("target settles");
        service
            .arm(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm while idle");
        assert_eq!(
            service
                .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
                .await
                .expect("the next turn finishes")
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn a_workflow_controlled_watcher_is_not_prompted_and_keeps_its_schedule() {
        // H1. A pointer is a prompt, and every other prompt path 409s a
        // workflow-controlled session. The schedule is left ARMED rather than
        // consumed, so the watcher still gets the wake it asked for once the
        // run releases control.
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        let store = SessionStore::new(db);
        for (id, title) in [
            ("ses_watcher", "Deploy Checker"),
            ("ses_watcher_2", "Release notes"),
            ("ses_target", "Schema audit"),
        ] {
            store
                .insert(&session_record(id, Some(title)))
                .expect("insert session");
        }
        let service = AgentWakeService::new(
            store.clone(),
            Arc::new(SessionMutationAdmission::new(Arc::new(ControlledSession {
                session_id: "ses_watcher",
            }))),
        );
        service
            .arm(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm controlled watcher");
        service
            .arm(
                "ses_watcher_2",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm ordinary watcher");

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("the target's turn ends");

        // Negative control in the same assertion: the ordinary watcher IS
        // woken by the same turn, so the refusal above is the controller
        // lookup and not a blanket block.
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].consumed.watcher_session_id, "ses_watcher_2");
        assert!(store
            .list_pending_prompts("ses_watcher")
            .expect("pending prompts")
            .is_empty());
        let remaining = store
            .list_agent_wakes_for_watcher("ses_watcher")
            .expect("list schedules");
        assert_eq!(remaining.len(), 1, "the schedule must survive, still armed");

        // Control releases (an uncontrolled service over the same rows): the
        // very same schedule fires at the next finished turn.
        let released = AgentWakeService::new(store.clone(), uncontrolled_admission());
        let fired = released
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("the next turn ends");
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].consumed.watcher_session_id, "ses_watcher");
        assert_eq!(
            store
                .list_pending_prompts("ses_watcher")
                .expect("pending prompts")
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn a_closed_watcher_is_never_prompted_and_its_schedule_is_dropped() {
        // Ruling 6: a closed session takes no input. Leaving the row armed
        // instead would strand it forever, since nothing will ever consume it.
        let service = service_fixture();
        service
            .arm(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        close_session(&service, "ses_watcher");

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("consume");

        assert!(fired.is_empty());
        assert!(service
            .session_store()
            .list_pending_prompts("ses_watcher")
            .expect("pending prompts")
            .is_empty());
        assert!(service
            .session_store()
            .list_agent_wakes_for_target("ses_target")
            .expect("list schedules")
            .is_empty());
    }

    #[tokio::test]
    async fn a_closed_targets_schedules_are_cleared_rather_than_left_unconsumable() {
        // Arming on a closed target is refused, so these rows can only come
        // from a target that closed AFTER the arm. They can never fire; this is
        // the close-detection point this layer reaches.
        let service = service_fixture();
        service
            .arm(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        close_session(&service, "ses_target");

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("consume");

        assert!(fired.is_empty());
        assert!(service
            .session_store()
            .list_agent_wakes_for_target("ses_target")
            .expect("list schedules")
            .is_empty());
        assert!(service
            .session_store()
            .list_pending_prompts("ses_watcher")
            .expect("pending prompts")
            .is_empty());
    }

    #[tokio::test]
    async fn every_watcher_of_one_target_gets_its_own_pointer() {
        let service = service_fixture();
        service
            .session_store()
            .insert(&session_record("ses_watcher_2", Some("Release notes")))
            .expect("insert second watcher");
        service
            .arm(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");
        service
            .arm(
                "ses_watcher_2",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
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

    #[tokio::test]
    async fn the_queued_pointer_is_the_envelope_text_and_carries_the_outcome() {
        let service = service_fixture();
        service
            .arm(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm");

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Failed)
            .await
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

    #[tokio::test]
    async fn a_closed_target_cannot_be_waited_on() {
        let service = service_fixture();
        let mut closed = session_record("ses_closed", Some("Retired"));
        closed.closed_at = Some("2026-08-08T01:00:00Z".to_string());
        closed.status = "closed".to_string();
        service
            .session_store()
            .insert(&closed)
            .expect("insert closed target");

        let error = service
            .arm(
                "ses_watcher",
                "ses_closed",
                AgentWakeReason::ExplicitSchedule,
            )
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
            .arm(
                "ses_watcher",
                "ses_ghost",
                AgentWakeReason::ExplicitSchedule,
            )
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
            .arm(
                "ses_watcher",
                "ses_watcher",
                AgentWakeReason::ExplicitSchedule,
            )
            .err()
            .expect("self-wake is rejected");

        assert!(matches!(error, AgentAccessError::SelfTarget));
    }

    #[tokio::test]
    async fn consuming_a_reply_arm_removes_the_schedule_so_the_turn_end_wakes_nobody() {
        let service = service_fixture();
        service
            .arm("ses_watcher", "ses_target", AgentWakeReason::Reply)
            .expect("arm");

        assert!(service
            .consume_reply_arm("ses_watcher", "ses_target")
            .expect("consume"));
        assert!(!service
            .consume_reply_arm("ses_watcher", "ses_target")
            .expect("consume again"));

        assert!(service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("consume")
            .is_empty());
        assert!(service
            .session_store()
            .list_pending_prompts("ses_watcher")
            .expect("pending prompts")
            .is_empty());
    }

    #[tokio::test]
    async fn an_explicit_schedule_survives_a_message_and_still_fires() {
        // M2: `consume_reply_arm` runs after ANY send in the target's
        // direction, including a courtesy "starting now". Only the reply arm it
        // is the safety net for may come off; the standalone schedule stands.
        let service = service_fixture();
        service
            .arm(
                "ses_watcher",
                "ses_target",
                AgentWakeReason::ExplicitSchedule,
            )
            .expect("arm an explicit schedule");

        assert!(
            !service
                .consume_reply_arm("ses_watcher", "ses_target")
                .expect("an incidental message consumes nothing"),
            "an explicit schedule is not a reply arm"
        );

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("the target's turn ends");
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].consumed.watcher_session_id, "ses_watcher");
    }

    #[tokio::test]
    async fn an_unwatched_targets_turn_queues_nothing() {
        let service = service_fixture();

        let fired = service
            .consume_for_finished_turn("ses_target", SessionTurnOutcome::Completed)
            .await
            .expect("consume");

        assert!(fired.is_empty());
        assert!(service
            .session_store()
            .list_pending_prompts("ses_watcher")
            .expect("pending prompts")
            .is_empty());
    }
}
