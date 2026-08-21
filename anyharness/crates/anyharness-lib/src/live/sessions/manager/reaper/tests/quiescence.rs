//! The sweep predicate: which live sessions are quiet enough to retire, the
//! actor's serial re-check of that verdict, and the fail-closed arm.

use super::*;

#[tokio::test]
async fn continuously_idle_session_is_reaped_after_the_threshold() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    let start = Instant::now();

    assert_eq!(reaper.sweep(start).await.reaped, Vec::<String>::new());
    assert!(is_live(&manager, "session-1").await);

    assert_eq!(
        reaper
            .sweep(start + THRESHOLD - Duration::from_secs(1))
            .await
            .reaped,
        Vec::<String>::new(),
        "a session short of the threshold must survive"
    );
    assert!(is_live(&manager, "session-1").await);

    assert_eq!(
        reaper.sweep(start + THRESHOLD).await.reaped,
        vec!["session-1".to_string()]
    );
    assert!(!is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn awaiting_interaction_session_is_never_reaped() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    let handle = register_live_session(
        &manager,
        "session-1",
        SessionExecutionPhase::AwaitingInteraction,
    )
    .await;
    handle
        .add_pending_interaction(PendingInteractionSummary {
            request_id: "request-1".to_string(),
            kind: anyharness_contract::v1::InteractionKind::Permission,
            title: "Run a tool".to_string(),
            description: None,
            source: PendingInteractionSource {
                tool_call_id: None,
                tool_kind: None,
                tool_status: None,
                linked_plan_id: None,
            },
            payload: PendingInteractionPayloadSummary::Permission {
                options: vec![],
                context: None,
            },
        })
        .await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    let start = Instant::now();
    reaper.sweep(start).await;
    let outcome = reaper.sweep(start + THRESHOLD * 10).await;

    assert_eq!(outcome.reaped, Vec::<String>::new());
    assert_eq!(outcome.awaiting_interaction_held, 1);
    assert!(is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn session_with_a_queued_prompt_is_not_reaped() {
    let store = seeded_store(&["session-1"]);
    store
        .insert_pending_prompt_payload(
            "session-1",
            &PromptPayload::text("queued work".to_string()),
            None,
        )
        .expect("insert pending prompt");
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(sweep_twice(&mut reaper).await, Vec::<String>::new());
    assert!(is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn session_with_live_background_work_is_not_reaped_until_it_completes() {
    let store = seeded_store(&["session-1"]);
    let record = pending_background_work("session-1");
    store
        .upsert_or_refresh_pending_background_work(&record)
        .expect("insert background work");
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    let start = Instant::now();
    reaper.sweep(start).await;
    let outcome = reaper.sweep(start + THRESHOLD).await;
    assert_eq!(outcome.reaped, Vec::<String>::new());
    assert_eq!(
        outcome.background_work_held, 1,
        "the second permanent-leak class must be counted, not invisible"
    );
    assert!(is_live(&manager, "session-1").await);

    store
        .mark_background_work_terminal(
            "session-1",
            &record.tool_call_id,
            SessionBackgroundWorkState::Completed,
            "2026-08-21T00:05:00Z",
        )
        .expect("mark background work terminal");

    assert_eq!(
        sweep_twice(&mut reaper).await,
        vec!["session-1".to_string()],
        "the same session becomes reapable once its tracker is terminal"
    );
    assert!(!is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn a_busy_handle_is_not_reaped() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    let handle = register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;
    handle.set_busy(true);

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(sweep_twice(&mut reaper).await, Vec::<String>::new());
    assert!(is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn activity_between_sweeps_restarts_the_idle_clock() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    let handle = register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    let start = Instant::now();
    reaper.sweep(start).await;

    // A notification arrived while the session sat idle. The handle bumps its
    // activity marker exactly as the actor's notification dispatch does.
    handle
        .mark_activity_at("2026-08-21T01:00:00Z".to_string())
        .await;

    assert_eq!(
        reaper.sweep(start + THRESHOLD).await.reaped,
        Vec::<String>::new(),
        "activity must restart the continuous-idleness clock"
    );
    assert!(is_live(&manager, "session-1").await);

    assert_eq!(
        reaper.sweep(start + THRESHOLD * 2).await.reaped,
        vec!["session-1".to_string()],
        "and the restarted clock must still run out"
    );
}

#[tokio::test]
async fn reaped_session_stays_resumable_with_its_native_session_id() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(
        sweep_twice(&mut reaper).await,
        vec!["session-1".to_string()]
    );

    // Exactly the durable shape the resume path consumes. With
    // `native_session_id` and `last_prompt_at` both present and the row still
    // non-terminal, `choose_session_startup_strategy` selects
    // `LoadNative(native_session_id)` (pinned by
    // `choose_startup_strategy_loads_claude_when_last_prompt_was_recorded` in
    // `domains/sessions/runtime/tests.rs`), so the next prompt lands back in
    // the same native conversation.
    //
    // Scope: the scripted actor here never runs `persist_exit_disposition`, so
    // `status == "idle"` below is the seeded value surviving the reap, not a
    // transition. The transition itself (a row seeded `"running"` that the
    // real Unload disposition writes back to `"idle"`) is proven against the
    // real actor loop in `actor/tests/idle_reap.rs`.
    let record = store
        .find_by_id("session-1")
        .expect("read session")
        .expect("session row survives reaping");
    assert_eq!(
        record.native_session_id.as_deref(),
        Some("native-session-1")
    );
    assert_eq!(record.status, "idle");
    assert_eq!(record.closed_at, None);
    assert_eq!(record.dismissed_at, None);
    assert_eq!(
        record.last_prompt_at.as_deref(),
        Some("2026-08-21T00:00:30Z")
    );
    assert!(!is_live(&manager, "session-1").await);
}

/// B3, manager side: when the actor refuses the conditional unload, the reaper
/// records nothing as reaped and leaves the session live. The actor-side proof
/// that a racing prompt is what triggers the refusal - and that it then runs -
/// is in `actor/tests/idle_reap.rs`.
#[tokio::test]
async fn an_actor_that_refuses_the_conditional_unload_keeps_its_session() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_busy_refusing_session(&manager, "session-1").await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(
        sweep_twice(&mut reaper).await,
        Vec::<String>::new(),
        "the actor's serial verdict overrides the sweep's stale observation"
    );
    assert!(is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn a_session_that_never_settles_is_not_reaped() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Running).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(sweep_twice(&mut reaper).await, Vec::<String>::new());
    assert!(is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn the_verdict_names_the_exact_condition_that_blocked_a_reap() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    let handle = register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let snapshot = handle.execution_snapshot().await;
    assert_eq!(
        manager.idle_reap_verdict("session-1", &handle, &snapshot),
        IdleReapVerdict::Quiescent
    );

    handle.set_busy(true);
    assert_eq!(
        manager.idle_reap_verdict("session-1", &handle, &snapshot),
        IdleReapVerdict::Busy
    );
    handle.set_busy(false);

    store
        .upsert_or_refresh_pending_background_work(&pending_background_work("session-1"))
        .expect("insert background work");
    assert_eq!(
        manager.idle_reap_verdict("session-1", &handle, &snapshot),
        IdleReapVerdict::BackgroundWork
    );
}

/// A failed durable read is `Undetermined`, and `Undetermined` never reaps.
/// This is the fail-closed property the whole predicate advertises, and it is
/// the one arm no behavioural test reached before.
#[tokio::test]
async fn a_failed_durable_read_is_undetermined_and_never_reaps() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    let handle = register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    // Drop the table the background-work read needs. The store call now
    // returns Err rather than an empty rowset, which is exactly the shape a
    // corrupted or locked database produces.
    store
        .db()
        .with_conn(|conn| {
            conn.execute("DROP TABLE session_background_work", [])?;
            Ok(())
        })
        .expect("drop the background-work table");

    let snapshot = handle.execution_snapshot().await;
    assert_eq!(
        manager.idle_reap_verdict("session-1", &handle, &snapshot),
        IdleReapVerdict::Undetermined
    );

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(
        sweep_twice(&mut reaper).await,
        Vec::<String>::new(),
        "missing evidence must never authorize a reap"
    );
    assert!(is_live(&manager, "session-1").await);
}
