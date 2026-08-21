//! Reaping a session that parents a pending wake schedule. Which relation the
//! link carries decides whether the wake can still be delivered to a cold
//! parent, so the two relations are pinned separately.

use super::*;

/// Acceptance test named by the delivery specification, scoped to what it
/// actually proves. A `subagent` parent IS reapable while a wake is scheduled,
/// and the wake still lands, because that relation's delivery does not need a
/// live parent: the child's terminal turn writes a
/// `session_link_completion_deliveries` row (`persist_terminal_turn_in_tx`,
/// `WHERE relation = 'subagent'`) and `CompletionDeliveryWorker` cold-starts
/// the parent through `activate_durable_prompt_consumer` /
/// `ensure_live_session_handle`.
///
/// What this test does NOT prove: the worker's cold start. That is the
/// delivery worker's own suite; here the assertions stop at the durable facts
/// this PR is responsible for - the schedule survives the reap, the completion
/// still produces the parent's wake prompt row with no live parent involved,
/// and the reaper then holds off the parent while that row exists.
#[tokio::test]
async fn a_subagent_parent_is_reapable_and_its_wake_still_becomes_a_durable_prompt() {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    store.insert(&session_record("session-1")).expect("parent");
    store.insert(&session_record("child-1")).expect("child");
    seed_link(&db, "link-1", "subagent", "session-1", "child-1");

    let completions = LinkCompletionStore::new(db.clone());
    assert!(completions
        .schedule_wake("link-1")
        .expect("schedule the parent wake"));

    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(
        sweep_twice(&mut reaper).await,
        vec!["session-1".to_string()],
        "a subagent parent's wake is delivered by the durable outbox worker, so \
         the parent is still reapable"
    );
    assert!(!is_live(&manager, "session-1").await);

    assert_eq!(
        completions
            .list_wake_schedules(&["link-1".to_string()])
            .expect("list wake schedules")
            .len(),
        1,
        "reaping must not consume or drop the wake schedule"
    );

    // The child finishes while the parent is reaped.
    let insert = completions
        .insert_completion_and_consume_schedule(
            &link_completion("link-1"),
            "session-1",
            &PromptPayload::text("your delegate finished".to_string()),
        )
        .expect("record the child completion")
        .expect("completion inserted");

    let wake_prompt = insert
        .wake_prompt
        .expect("a reaped parent must still be handed its wake prompt");
    assert_eq!(wake_prompt.session_id, "session-1");
    assert_eq!(
        store
            .list_pending_prompts("session-1")
            .expect("list pending prompts")
            .len(),
        1,
        "the wake is durable in the parent's queue"
    );

    // The queue is now non-empty, so the reaper holds off the freshly
    // cold-started parent instead of racing the wake back out of existence.
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;
    assert_eq!(sweep_twice(&mut reaper).await, Vec::<String>::new());
    assert!(is_live(&manager, "session-1").await);
}

/// B2: a cowork parent expecting a wake must NOT be reaped, because that
/// relation's delivery needs a live parent.
///
/// `deliver_cowork_coding_completion` sends the wake with
/// `acp_manager.get_handle(...)` and silently skips the send when the parent
/// is gone; no outbox row is written for a `cowork_coding_session` link
/// (`persist_terminal_turn_in_tx` selects `WHERE relation = 'subagent'`), and
/// nothing scans for stranded pending prompts. So a reaped cowork parent's
/// wake would sit in `session_pending_prompts` until a human next opened the
/// session. The predicate keeps the parent live instead.
#[tokio::test]
async fn a_cowork_parent_expecting_a_wake_is_not_reaped() {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    store.insert(&session_record("session-1")).expect("parent");
    store.insert(&session_record("child-1")).expect("child");
    seed_link(
        &db,
        "link-1",
        "cowork_coding_session",
        "session-1",
        "child-1",
    );

    let completions = LinkCompletionStore::new(db.clone());
    assert!(completions
        .schedule_wake("link-1")
        .expect("schedule the parent wake"));

    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    let handle = register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(
        sweep_twice(&mut reaper).await,
        Vec::<String>::new(),
        "reaping a cowork parent strands the wake its child is about to send"
    );
    assert!(is_live(&manager, "session-1").await);
    let snapshot = handle.execution_snapshot().await;
    assert_eq!(
        manager.idle_reap_verdict("session-1", &handle, &snapshot),
        IdleReapVerdict::PendingWake
    );

    // The child finishes and the wake lands on the still-live parent, which
    // consumes the schedule. Now the parent is an ordinary idle session again.
    completions
        .insert_completion_and_consume_schedule(
            &link_completion("link-1"),
            "session-1",
            &PromptPayload::text("your cowork agent finished".to_string()),
        )
        .expect("record the child completion")
        .expect("completion inserted");
    for pending in store
        .list_pending_prompts("session-1")
        .expect("list pending prompts")
    {
        store
            .delete_pending_prompt("session-1", pending.seq)
            .expect("drain the delivered wake");
    }
    assert_eq!(
        sweep_twice(&mut reaper).await,
        vec!["session-1".to_string()],
        "once the wake is delivered and drained the parent is reapable again"
    );
}
