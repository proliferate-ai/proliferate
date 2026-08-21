//! A reap is only non-terminal for a session the startup matrix will take
//! back, so the predicate asks the launch policy before retiring anything.

use super::*;

/// B1: a process-local (Claude) zero-turn fork child is fully quiescent from
/// the moment it is created - phase `Idle`, no interactions, nothing queued -
/// and `choose_fork_child_strategy` refuses to relaunch it
/// ("process-local zero-turn fork recovery requires an exact-prefix recovery
/// proof"). Before the reaper that state was only reachable after a process
/// restart; a two-minute timer must not make it routine, because the reap
/// would be permanent rather than non-terminal.
#[tokio::test]
async fn a_zero_turn_claude_fork_child_is_never_reaped() {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    store.insert(&session_record("parent-1")).expect("parent");
    let mut child = session_record("child-1");
    // Exactly how `runtime/fork/mod.rs` inserts a fork child.
    child.last_prompt_at = None;
    store.insert(&child).expect("child");
    seed_link(&db, "link-1", "fork", "parent-1", "child-1");

    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    let handle = register_live_session(&manager, "child-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(
        sweep_twice(&mut reaper).await,
        Vec::<String>::new(),
        "reaping a session no startup strategy accepts would end it permanently"
    );
    assert!(is_live(&manager, "child-1").await);
    let snapshot = handle.execution_snapshot().await;
    assert_eq!(
        manager.idle_reap_verdict("child-1", &handle, &snapshot),
        IdleReapVerdict::NotRelaunchable
    );

    // The same child, once it has run a turn of its own, loads from its
    // durable native id and is an ordinary reap candidate again.
    store
        .update_last_prompt_at("child-1", "2026-08-21T00:20:00Z")
        .expect("record the child's first turn");
    assert_eq!(
        sweep_twice(&mut reaper).await,
        vec!["child-1".to_string()],
        "a fork child that has run its own turn is relaunchable, so it is reapable"
    );
}

/// The carve-out must not be wider than the launch policy. A zero-turn Claude
/// session that is NOT a fork child resolves to `ResumeSeqFreshNative`, which
/// is a real strategy, so it stays reapable.
#[tokio::test]
async fn a_zero_turn_session_that_is_not_a_fork_child_is_still_reaped() {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    let mut record = session_record("session-1");
    record.last_prompt_at = None;
    store.insert(&record).expect("insert session");

    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(
        sweep_twice(&mut reaper).await,
        vec!["session-1".to_string()]
    );
}
