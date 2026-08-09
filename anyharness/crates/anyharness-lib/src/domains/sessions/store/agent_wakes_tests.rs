use super::*;
use crate::app::test_support;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::persistence::Db;

fn session_record(id: &str) -> SessionRecord {
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
        title: Some(format!("Agent {id}")),
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

fn store_fixture() -> SessionStore {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    let store = SessionStore::new(db);
    for id in ["ses_watcher", "ses_target"] {
        store.insert(&session_record(id)).expect("insert session");
    }
    store
}

fn no_controlled_watchers() -> HashSet<String> {
    HashSet::new()
}

fn close_session(store: &SessionStore, session_id: &str) {
    store
        .db
        .with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET closed_at = ?2, status = 'closed' WHERE id = ?1",
                params![session_id, "2026-08-08T02:00:00Z"],
            )
        })
        .expect("close session");
}

#[test]
fn the_pair_key_makes_a_double_arm_one_row() {
    let store = store_fixture();

    assert!(store
        .arm_agent_wake(
            "ses_watcher",
            "ses_target",
            AgentWakeReason::ExplicitSchedule
        )
        .expect("arm"));
    assert!(!store
        .arm_agent_wake(
            "ses_watcher",
            "ses_target",
            AgentWakeReason::ExplicitSchedule
        )
        .expect("arm again"));

    assert_eq!(
        store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")
            .len(),
        1
    );
}

#[test]
fn the_row_records_why_it_was_armed_and_never_downgrades_to_a_reply_arm() {
    // The reason decides what may consume the row early, so re-arming
    // resolves to the STRONGER one: an explicit schedule outranks a reply
    // arm, and a later reply arm cannot pull it back down.
    let store = store_fixture();

    store
        .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
        .expect("arm for reply");
    assert!(
        store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")[0]
            .armed_for_reply
    );

    store
        .arm_agent_wake(
            "ses_watcher",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("upgrade to an explicit schedule");
    assert!(
        !store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")[0]
            .armed_for_reply
    );

    store
        .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
        .expect("arm for reply again");
    assert!(
        !store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")[0]
            .armed_for_reply,
        "an explicit schedule must not be downgraded by a later wakeOnReply send"
    );
}

#[test]
fn a_reply_consumes_only_a_reply_arm() {
    // An incidental message from the target ("starting now") must not
    // cancel an explicit schedule; it only ever consumes the reply arm it
    // is the answer to.
    let store = store_fixture();
    store
        .arm_agent_wake(
            "ses_watcher",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");

    assert!(!store
        .consume_reply_agent_wake("ses_watcher", "ses_target")
        .expect("consume reply"));
    assert_eq!(
        store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")
            .len(),
        1
    );

    store
        .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
        .expect("re-arm");
    // The row is still the explicit schedule (no downgrade), so the reply
    // still leaves it alone.
    assert!(!store
        .consume_reply_agent_wake("ses_watcher", "ses_target")
        .expect("consume reply"));
}

#[test]
fn a_reply_arm_is_consumed_by_the_reply() {
    let store = store_fixture();
    store
        .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
        .expect("arm");

    assert!(store
        .consume_reply_agent_wake("ses_watcher", "ses_target")
        .expect("consume reply"));
    assert!(store
        .list_agent_wakes_for_target("ses_target")
        .expect("list")
        .is_empty());
}

#[test]
fn compensation_spares_a_row_a_landed_send_relies_on() {
    // Two concurrent sends share one row: the first armed it, the second
    // reused it and LANDED. The first's failure compensation must not take
    // away the schedule the landed send owes its watcher.
    let store = store_fixture();
    store
        .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
        .expect("send A arms");
    assert!(!store
        .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
        .expect("send B re-arms"));

    assert!(store
        .confirm_agent_wake_dispatch("ses_watcher", "ses_target")
        .expect("send B lands"));
    assert!(!store
        .delete_unconfirmed_reply_agent_wake("ses_watcher", "ses_target")
        .expect("send A compensates"));

    assert_eq!(
        store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")
            .len(),
        1,
        "the landed send's schedule must survive the failed send's compensation"
    );
}

#[test]
fn confirming_re_arms_a_row_a_racing_compensation_already_removed() {
    // The other order: the failing send compensates BEFORE the landed one
    // confirms. Confirming re-arms, so the landed send's watcher still gets
    // its wake — the row is the promise, not the ordering.
    let store = store_fixture();
    store
        .arm_agent_wake("ses_watcher", "ses_target", AgentWakeReason::Reply)
        .expect("send A arms");
    assert!(store
        .delete_unconfirmed_reply_agent_wake("ses_watcher", "ses_target")
        .expect("send A compensates first"));

    assert!(store
        .confirm_agent_wake_dispatch("ses_watcher", "ses_target")
        .expect("send B lands after"));

    let rows = store
        .list_agent_wakes_for_target("ses_target")
        .expect("list");
    assert_eq!(rows.len(), 1);
    assert!(rows[0].armed_for_reply);
    assert!(rows[0].dispatch_confirmed_at.is_some());
}

#[test]
fn confirming_a_closed_target_re_arms_nothing() {
    // A closed target never finishes another turn, so re-arming one would
    // only leave a row nothing can consume.
    let store = store_fixture();
    close_session(&store, "ses_target");

    assert!(!store
        .confirm_agent_wake_dispatch("ses_watcher", "ses_target")
        .expect("confirm"));
    assert!(store
        .list_agent_wakes_for_target("ses_target")
        .expect("list")
        .is_empty());
}

#[test]
fn the_table_refuses_a_session_watching_itself() {
    let store = store_fixture();

    let error = store
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_wake_schedules (
                    watcher_session_id, target_session_id, created_at
                 ) VALUES ('ses_watcher', 'ses_watcher', '2026-08-08T00:00:00Z')",
                [],
            )
        })
        .err()
        .expect("the CHECK constraint rejects a self-wake");
    assert!(error.to_string().to_lowercase().contains("constraint"));

    // The store's own arm surfaces that violation rather than swallowing
    // it: `INSERT OR IGNORE` used to report a plain no-op here, which made
    // the SQL guard invisible to every caller. A self-arm is unreachable in
    // practice — `authorize` refuses `SelfTarget` before any store call —
    // and this pins that the layer under it is not silently permissive.
    let error = store
        .arm_agent_wake(
            "ses_watcher",
            "ses_watcher",
            AgentWakeReason::ExplicitSchedule,
        )
        .err()
        .expect("a self-arm errors at the SQL layer");
    assert!(error.to_string().to_lowercase().contains("constraint"));
    assert!(store
        .list_agent_wakes_for_target("ses_watcher")
        .expect("list")
        .is_empty());
}

#[test]
fn consumption_queues_exactly_one_prompt_per_deleted_schedule() {
    let store = store_fixture();
    store
        .insert(&session_record("ses_watcher_2"))
        .expect("insert second watcher");
    store
        .arm_agent_wake(
            "ses_watcher",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");
    store
        .arm_agent_wake(
            "ses_watcher_2",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");
    let payload = PromptPayload::text("pointer".to_string());

    let consumption = store
        .consume_agent_wakes_for_target("ses_target", &payload, &no_controlled_watchers())
        .expect("consume");

    assert_eq!(consumption.fired.len(), 2);
    assert!(store
        .list_agent_wakes_for_target("ses_target")
        .expect("list")
        .is_empty());
    for watcher in ["ses_watcher", "ses_watcher_2"] {
        let pending = store
            .list_pending_prompts(watcher)
            .expect("pending prompts");
        assert_eq!(
            pending.len(),
            1,
            "{watcher} should have exactly one pointer"
        );
        assert_eq!(pending[0].text, "pointer");
    }
}

#[test]
fn a_controlled_watcher_keeps_its_schedule_and_takes_no_pointer() {
    // A workflow owns this watcher's execution, so it takes no prompt —
    // and its schedule is NOT consumed, so the wake it asked for still
    // fires once control releases.
    let store = store_fixture();
    store
        .insert(&session_record("ses_watcher_2"))
        .expect("insert second watcher");
    store
        .arm_agent_wake(
            "ses_watcher",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");
    store
        .arm_agent_wake(
            "ses_watcher_2",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");
    let payload = PromptPayload::text("pointer".to_string());
    let controlled = HashSet::from(["ses_watcher".to_string()]);

    let consumption = store
        .consume_agent_wakes_for_target("ses_target", &payload, &controlled)
        .expect("consume");

    assert_eq!(consumption.left_armed_controlled_watchers, ["ses_watcher"]);
    assert_eq!(consumption.fired.len(), 1);
    assert_eq!(consumption.fired[0].watcher_session_id, "ses_watcher_2");
    assert!(store
        .list_pending_prompts("ses_watcher")
        .expect("pending prompts")
        .is_empty());
    let remaining = store
        .list_agent_wakes_for_target("ses_target")
        .expect("list");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].watcher_session_id, "ses_watcher");

    // Control releases: the very same schedule fires at the next finished
    // turn, so nothing was lost by skipping it.
    let consumption = store
        .consume_agent_wakes_for_target("ses_target", &payload, &no_controlled_watchers())
        .expect("consume after release");
    assert_eq!(consumption.fired.len(), 1);
    assert_eq!(consumption.fired[0].watcher_session_id, "ses_watcher");
}

#[test]
fn a_closed_watchers_schedule_is_dropped_without_a_pointer() {
    // Ruling 6: a closed session takes no input. The row cannot be left
    // armed either — nothing would ever consume it.
    let store = store_fixture();
    store
        .arm_agent_wake(
            "ses_watcher",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");
    close_session(&store, "ses_watcher");
    let payload = PromptPayload::text("pointer".to_string());

    let consumption = store
        .consume_agent_wakes_for_target("ses_target", &payload, &no_controlled_watchers())
        .expect("consume");

    assert!(consumption.fired.is_empty());
    assert_eq!(consumption.dropped_closed_watchers, ["ses_watcher"]);
    assert!(store
        .list_pending_prompts("ses_watcher")
        .expect("pending prompts")
        .is_empty());
    assert!(store
        .list_agent_wakes_for_target("ses_target")
        .expect("list")
        .is_empty());
}

#[test]
fn a_wake_on_one_target_is_untouched_by_another_targets_turn() {
    let store = store_fixture();
    store
        .insert(&session_record("ses_other"))
        .expect("insert other target");
    store
        .arm_agent_wake(
            "ses_watcher",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");
    store
        .arm_agent_wake(
            "ses_watcher",
            "ses_other",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");
    let payload = PromptPayload::text("pointer".to_string());

    let consumption = store
        .consume_agent_wakes_for_target("ses_other", &payload, &no_controlled_watchers())
        .expect("consume");

    assert_eq!(consumption.fired.len(), 1);
    let remaining = store
        .list_agent_wakes_for_watcher("ses_watcher")
        .expect("list");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].target_session_id, "ses_target");
}

#[test]
fn a_failed_enqueue_rolls_the_whole_consumption_back() {
    // Atomicity, the guarantee the link-scoped wake also makes: a schedule
    // is never consumed without its prompt, and one watcher's failure
    // cannot leave another watcher's schedule deleted. A trigger fails the
    // SECOND watcher's enqueue, so the first watcher's already-executed
    // DELETE and INSERT have to roll back with it.
    let store = store_fixture();
    store
        .insert(&session_record("ses_watcher_2"))
        .expect("insert second watcher");
    store
        .arm_agent_wake(
            "ses_watcher",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");
    store
        .arm_agent_wake(
            "ses_watcher_2",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");
    store
        .db
        .with_conn(|conn| {
            conn.execute_batch(
                "CREATE TRIGGER refuse_second_watcher
                 BEFORE INSERT ON session_pending_prompts
                 WHEN NEW.session_id = 'ses_watcher_2'
                 BEGIN SELECT RAISE(ABORT, 'enqueue refused'); END;",
            )?;
            Ok(())
        })
        .expect("install the failing enqueue");
    let payload = PromptPayload::text("pointer".to_string());

    store
        .consume_agent_wakes_for_target("ses_target", &payload, &no_controlled_watchers())
        .expect_err("the enqueue fails");

    assert_eq!(
        store
            .list_agent_wakes_for_target("ses_target")
            .expect("list")
            .len(),
        2,
        "a schedule must never be consumed without its prompt"
    );
    assert!(
        store
            .list_pending_prompts("ses_watcher")
            .expect("pending prompts")
            .is_empty(),
        "the first watcher's prompt must roll back with the failed one"
    );
}

#[test]
fn a_closed_targets_schedules_can_be_cleared_in_one_sweep() {
    let store = store_fixture();
    store
        .insert(&session_record("ses_watcher_2"))
        .expect("insert second watcher");
    store
        .arm_agent_wake(
            "ses_watcher",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");
    store
        .arm_agent_wake(
            "ses_watcher_2",
            "ses_target",
            AgentWakeReason::ExplicitSchedule,
        )
        .expect("arm");

    assert_eq!(
        store
            .delete_agent_wakes_for_target("ses_target")
            .expect("clear"),
        2
    );
    assert!(store
        .list_agent_wakes_for_target("ses_target")
        .expect("list")
        .is_empty());
}
