//! Startup readiness and generation-retirement ownership regressions.

use std::time::Instant;

use super::super::{startup::wait_for_new_startup_readiness, StartupReadinessState};
use super::*;
use crate::live::sessions::actor::spawn::PendingSessionActor;

#[tokio::test]
async fn ready_generation_does_not_remove_replacement_pending_startup() {
    let manager = manager_for_store(&SessionStore::new(Db::open_in_memory().expect("open db")));
    let (old_command_tx, _old_command_rx) = mpsc::channel(1);
    let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4);
    let old_handle = Arc::new(LiveSessionHandle::new(
        "session-1",
        None,
        old_command_tx,
        event_tx.clone(),
        None,
        SessionExecutionPhase::Starting,
    ));
    manager
        .live_sessions
        .write()
        .await
        .insert("session-1".to_string(), old_handle.clone());

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<anyhow::Result<String>>();
    let (startup_cancel_tx, _startup_cancel_rx) = oneshot::channel();
    let pending = PendingSessionActor::new_for_test(
        old_handle.clone(),
        ready_rx,
        startup_cancel_tx,
        Duration::from_secs(1),
    );
    let (old_startup_tx, mut old_startup_rx) = watch::channel::<StartupReadinessState>(None);
    manager
        .pending_startups
        .write()
        .await
        .insert("session-1".to_string(), old_startup_rx.clone());

    // Hold the live registry after readiness publishes but before the
    // manager-owned success cleanup can inspect the current generation.
    let mut sessions = manager.live_sessions.write().await;
    let readiness_wait = tokio::spawn(wait_for_new_startup_readiness(
        pending,
        old_startup_tx,
        manager.live_sessions.clone(),
        manager.pending_startups.clone(),
        old_handle,
        "test".to_string(),
        Instant::now(),
        Instant::now(),
    ));
    ready_tx
        .send(Ok("old-native".to_string()))
        .expect("send old readiness");
    old_startup_rx
        .changed()
        .await
        .expect("old readiness update");

    let (replacement_command_tx, _replacement_command_rx) = mpsc::channel(1);
    let replacement_handle = Arc::new(LiveSessionHandle::new_for_test(
        "session-1",
        replacement_command_tx,
        event_tx,
        None,
        SessionExecutionPhase::Starting,
    ));
    sessions.insert("session-1".to_string(), replacement_handle.clone());
    let (replacement_startup_tx, replacement_startup_rx) =
        watch::channel::<StartupReadinessState>(None);
    manager
        .pending_startups
        .write()
        .await
        .insert("session-1".to_string(), replacement_startup_rx);
    drop(sessions);

    let readiness_result = readiness_wait.await.expect("readiness wait task");
    match readiness_result {
        Ok(ready) => assert_eq!(ready.native_session_id, "old-native"),
        Err(error) => panic!("old readiness failed: {error}"),
    }
    assert!(matches!(
        manager.live_sessions.read().await.get("session-1"),
        Some(current) if Arc::ptr_eq(current, &replacement_handle)
    ));
    let mut stored_replacement_readiness = manager
        .pending_startups
        .read()
        .await
        .get("session-1")
        .cloned()
        .expect("replacement readiness preserved");
    replacement_startup_tx
        .send(Some(Ok("replacement-native".to_string())))
        .expect("send replacement readiness");
    stored_replacement_readiness
        .changed()
        .await
        .expect("replacement readiness update");
    assert!(matches!(
        stored_replacement_readiness.borrow().as_ref(),
        Some(Ok(native_session_id)) if native_session_id == "replacement-native"
    ));
}

#[tokio::test]
async fn startup_timeout_keeps_generation_until_sequence_owner_finishes() {
    let store = seeded_session_store();
    let manager = manager_for_store(&store);
    let (command_tx, command_rx) = mpsc::channel(1);
    let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4);
    let handle = Arc::new(LiveSessionHandle::new(
        "session-1",
        command_tx,
        event_tx,
        None,
        SessionExecutionPhase::Starting,
    ));
    let event_sequence_releaser = handle.event_sequence_releaser();
    let actor_finished_releaser = handle.actor_finished_releaser();
    manager
        .live_sessions
        .write()
        .await
        .insert("session-1".to_string(), handle.clone());

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<anyhow::Result<String>>();
    let (startup_cancel_tx, startup_cancel_rx) = oneshot::channel();
    let pending = PendingSessionActor::new_for_test(
        handle.clone(),
        ready_rx,
        startup_cancel_tx,
        Duration::from_millis(20),
    );
    let (startup_tx, mut startup_rx) = watch::channel::<StartupReadinessState>(None);
    manager
        .pending_startups
        .write()
        .await
        .insert("session-1".to_string(), startup_rx.clone());

    let (cancel_seen_tx, cancel_seen_rx) = oneshot::channel();
    let (release_owner_tx, release_owner_rx) = oneshot::channel();
    let (sequence_released_tx, sequence_released_rx) = oneshot::channel();
    let (finish_owner_tx, finish_owner_rx) = oneshot::channel();
    let owner_store = store.clone();
    let owner = tokio::spawn(async move {
        startup_cancel_rx.await.expect("startup cancellation");
        drop(command_rx);
        let _ = cancel_seen_tx.send(());
        let _ = release_owner_rx.await;
        owner_store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq: 1,
                timestamp: "2026-08-17T00:00:00Z".to_string(),
                event_type: "session_info_update".to_string(),
                turn_id: None,
                item_id: None,
                payload_json: r#"{"type":"session_info_update"}"#.to_string(),
            })
            .expect("persist delayed startup event");
        drop(event_sequence_releaser);
        let _ = sequence_released_tx.send(());
        let _ = finish_owner_rx.await;
        drop(actor_finished_releaser);
        drop(ready_tx);
    });

    let startup_wait = tokio::spawn(wait_for_new_startup_readiness(
        pending,
        startup_tx,
        manager.live_sessions.clone(),
        manager.pending_startups.clone(),
        handle.clone(),
        "test".to_string(),
        Instant::now(),
        Instant::now(),
    ));

    tokio::time::timeout(Duration::from_secs(1), cancel_seen_rx)
        .await
        .expect("startup cancellation timeout")
        .expect("startup cancellation signal");
    startup_rx.changed().await.expect("readiness error update");
    assert!(matches!(startup_rx.borrow().as_ref(), Some(Err(_))));
    assert!(matches!(
        manager.live_sessions.read().await.get("session-1"),
        Some(current) if Arc::ptr_eq(current, &handle)
    ));
    assert!(manager
        .pending_startups
        .read()
        .await
        .contains_key("session-1"));
    assert!(manager
        .run_if_session_absent("session-1", || ())
        .await
        .is_none());

    let injection_manager = manager.clone();
    let injection = tokio::spawn(async move {
        injection_manager
            .emit_runtime_event(
                "session-1",
                RuntimeInjectedSessionEvent::SessionInfoUpdate {
                    title: Some("Pinned".to_string()),
                    updated_at: None,
                },
            )
            .await
    });
    tokio::task::yield_now().await;
    assert!(!injection.is_finished());
    assert!(store
        .list_events("session-1")
        .expect("events before handoff")
        .is_empty());

    let _ = release_owner_tx.send(());
    sequence_released_rx
        .await
        .expect("sequence release notification");
    let injected = tokio::time::timeout(Duration::from_secs(1), injection)
        .await
        .expect("runtime injection timeout")
        .expect("runtime injection task")
        .expect("runtime injection result");
    assert_eq!(injected.seq, 2);
    assert!(!startup_wait.is_finished());
    assert!(manager
        .pending_startups
        .read()
        .await
        .contains_key("session-1"));

    let _ = finish_owner_tx.send(());
    owner.await.expect("owner task");
    let startup_result = tokio::time::timeout(Duration::from_secs(1), startup_wait)
        .await
        .expect("startup retirement timeout")
        .expect("startup wait task");
    match startup_result {
        Ok(_) => panic!("timed-out startup unexpectedly became ready"),
        Err(error) => assert!(error.to_string().contains("startup timed out")),
    }
    assert!(!manager
        .pending_startups
        .read()
        .await
        .contains_key("session-1"));
    let events = store.list_events("session-1").expect("ordered events");
    assert_eq!(
        events.iter().map(|event| event.seq).collect::<Vec<_>>(),
        vec![1, 2]
    );
}

#[tokio::test]
async fn aborted_startup_waiter_does_not_strand_generation_registries() {
    let manager = manager_for_store(&seeded_session_store());
    let (command_tx, command_rx) = mpsc::channel(1);
    let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4);
    let handle = Arc::new(LiveSessionHandle::new(
        "session-1",
        command_tx,
        event_tx,
        None,
        SessionExecutionPhase::Starting,
    ));
    let event_sequence_releaser = handle.event_sequence_releaser();
    let actor_finished_releaser = handle.actor_finished_releaser();
    manager
        .live_sessions
        .write()
        .await
        .insert("session-1".to_string(), handle.clone());

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<anyhow::Result<String>>();
    let (startup_cancel_tx, startup_cancel_rx) = oneshot::channel();
    let pending = PendingSessionActor::new_for_test(
        handle.clone(),
        ready_rx,
        startup_cancel_tx,
        Duration::from_millis(20),
    );
    let (startup_tx, mut startup_rx) = watch::channel::<StartupReadinessState>(None);
    manager
        .pending_startups
        .write()
        .await
        .insert("session-1".to_string(), startup_rx.clone());

    let (cancel_seen_tx, cancel_seen_rx) = oneshot::channel();
    let (release_owner_tx, release_owner_rx) = oneshot::channel();
    let owner = tokio::spawn(async move {
        startup_cancel_rx.await.expect("startup cancellation");
        drop(command_rx);
        let _ = cancel_seen_tx.send(());
        let _ = release_owner_rx.await;
        drop(event_sequence_releaser);
        drop(actor_finished_releaser);
        drop(ready_tx);
    });

    let initiating_waiter = tokio::spawn(wait_for_new_startup_readiness(
        pending,
        startup_tx,
        manager.live_sessions.clone(),
        manager.pending_startups.clone(),
        handle.clone(),
        "test".to_string(),
        Instant::now(),
        Instant::now(),
    ));
    tokio::time::timeout(Duration::from_secs(1), cancel_seen_rx)
        .await
        .expect("startup cancellation timeout")
        .expect("startup cancellation signal");
    startup_rx.changed().await.expect("readiness error update");
    assert!(matches!(startup_rx.borrow().as_ref(), Some(Err(_))));
    assert!(matches!(
        manager.live_sessions.read().await.get("session-1"),
        Some(current) if Arc::ptr_eq(current, &handle)
    ));
    assert!(manager
        .pending_startups
        .read()
        .await
        .contains_key("session-1"));

    initiating_waiter.abort();
    assert!(matches!(
        initiating_waiter.await,
        Err(error) if error.is_cancelled()
    ));
    let _ = release_owner_tx.send(());
    owner.await.expect("owner task");

    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let live_absent = manager
                .live_sessions
                .read()
                .await
                .get("session-1")
                .is_none();
            let pending_absent = !manager
                .pending_startups
                .read()
                .await
                .contains_key("session-1");
            if live_absent && pending_absent {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("manager-owned startup retirement timeout");
    assert_eq!(
        manager
            .run_if_session_absent("session-1", || "replacement admitted")
            .await,
        Some("replacement admitted")
    );
}
