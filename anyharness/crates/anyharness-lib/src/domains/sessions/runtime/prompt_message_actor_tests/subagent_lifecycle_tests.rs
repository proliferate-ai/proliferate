use std::sync::Arc;

use super::*;
use crate::domains::agent_operations::model::{AgentRole, ListAgentsInput};
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::subagents::delivery::CompletionDeliveryStore;
use anyharness_contract::v1::SessionEvent;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reversible_open_cold_starts_the_same_native_conversation_without_replay() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("subagent-open");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(&runtime_home, Db::open_in_memory().expect("db"), false);
    let workspace = runtime_home.join("workspace-a");
    std::fs::create_dir_all(&workspace).expect("workspace");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-a",
        "local",
        &workspace.to_string_lossy(),
    );
    let mut target = session("target", "workspace-a", "idle", "Target");
    target.last_prompt_at = Some("2026-08-11T00:01:00Z".into());
    for record in [session("caller", "workspace-a", "idle", "Caller"), target] {
        state
            .session_service
            .store()
            .insert(&record)
            .expect("session");
        state
            .session_service
            .store()
            .seed_empty_launch_intent(&record.id);
    }
    state
        .subagent_service
        .link_child("caller", "target", None, None, None)
        .expect("relationship");
    state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("initial actor");
    wait_for_actor_idle(&state).await;
    // Stop the live actor before queueing the prompt: an idle actor
    // legitimately drains the durable queue once its startup grace elapses,
    // so insert-then-close against a live actor races that drain and loses
    // on slow CI runners. Close's queue purge is a store transaction that
    // needs no live actor; unload of a live actor is asserted by the second
    // close at the end of this test.
    stop_target_actor(&state).await;
    state
        .session_service
        .store()
        .insert_pending_prompt("target", "discarded on Close", Some("discarded"))
        .expect("queued prompt");

    let closed = state
        .session_runtime
        .close_subagent("caller", "target")
        .await
        .expect("reversible close");
    assert_eq!(closed.native_session_id.as_deref(), Some("native-target"));
    assert!(state
        .session_service
        .store()
        .list_pending_prompts("target")
        .unwrap()
        .is_empty());

    let opened = state
        .session_runtime
        .open_subagent("caller", "target")
        .await
        .expect("cold open");
    wait_for_actor_idle(&state).await;
    assert_eq!(opened.native_session_id.as_deref(), Some("native-target"));
    let requests = read_requests(&script.request_log);
    let loads = requests
        .iter()
        .filter(|request| request["method"] == "session/load")
        .collect::<Vec<_>>();
    assert_eq!(loads.len(), 2);
    assert!(loads
        .iter()
        .all(|request| request["params"]["sessionId"] == "native-target"));
    assert!(prompt_texts(&script.request_log).is_empty());

    // Reversible close of a live actor unloads it without touching the
    // durable native-session pointer.
    let closed_live = state
        .session_runtime
        .close_subagent("caller", "target")
        .await
        .expect("reversible close of a live actor");
    wait_for_actor_gone(&state).await;
    assert_eq!(
        closed_live.native_session_id.as_deref(),
        Some("native-target")
    );

    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn live_promotion_preserves_the_running_turn_and_removes_all_parent_behavior() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("subagent-promote");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(&runtime_home, Db::open_in_memory().expect("db"), false);
    let workspace = runtime_home.join("workspace-a");
    std::fs::create_dir_all(&workspace).expect("workspace");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-a",
        "local",
        &workspace.to_string_lossy(),
    );
    for record in [
        session("caller", "workspace-a", "idle", "Caller"),
        session("target", "workspace-a", "idle", "Target"),
    ] {
        state
            .session_service
            .store()
            .insert(&record)
            .expect("session");
        state
            .session_service
            .store()
            .seed_empty_launch_intent(&record.id);
    }
    let link = state
        .subagent_service
        .link_child("caller", "target", None, None, None)
        .expect("relationship");
    state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("actor");
    send_direct_prompt(&state, "blocking turn").await;
    wait_for_path(&script.control_dir.join("turn-seen")).await;
    let before = state
        .acp_manager
        .get_handle("target")
        .await
        .expect("running actor");
    assert!(before.is_busy());

    let promoted = state
        .session_runtime
        .promote_subagent("caller", "target")
        .await
        .expect("promote running child");
    let after = state
        .acp_manager
        .get_handle("target")
        .await
        .expect("same actor");
    assert!(Arc::ptr_eq(&before, &after));
    assert!(after.is_busy());
    assert_eq!(promoted.native_session_id.as_deref(), Some("native-target"));
    assert!(state
        .subagent_service
        .list_subagents("caller")
        .unwrap()
        .is_empty());
    assert!(state
        .session_runtime
        .session_link_service
        .find_subagent_link("caller", "target")
        .unwrap()
        .is_none());
    let page = state
        .agent_operations
        .list_agents(
            &state.agent_operations.authenticated_caller("caller"),
            ListAgentsInput::default(),
        )
        .await
        .expect("ordinary roster");
    assert!(page.agents.iter().any(|agent| {
        agent.identity.session_id == "target"
            && agent.role == AgentRole::Ordinary
            && agent.parent.is_none()
    }));

    std::fs::write(script.control_dir.join("release-turn"), b"").expect("release turn");
    wait_for_actor_idle(&state).await;
    assert_eq!(prompt_texts(&script.request_log), ["blocking turn"]);
    assert!(
        crate::domains::sessions::links::completions::LinkCompletionStore::new(state.db.clone())
            .list_completions_for_links(&[link.id])
            .unwrap()
            .is_empty()
    );
    assert!(state
        .session_service
        .store()
        .list_pending_prompts("caller")
        .unwrap()
        .is_empty());
    assert!(!state
        .session_service
        .store()
        .list_events("caller")
        .unwrap()
        .iter()
        .any(|event| event.event_type == "subagent_turn_completed"));

    stop_target_actor(&state).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn startup_refuses_an_unrepaired_turn_then_starts_after_atomic_repair() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("startup-repair-gate");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(&runtime_home, Db::open_in_memory().expect("db"), true);
    let parent = session("repair-parent", "workspace-b", "idle", "Parent");
    state
        .session_service
        .store()
        .insert(&parent)
        .expect("parent");
    state
        .session_service
        .store()
        .seed_empty_launch_intent(&parent.id);
    state
        .subagent_service
        .link_child("repair-parent", "target", Some("worker".into()), None, None)
        .expect("link");
    state
        .session_service
        .store()
        .append_event(&crate::domains::sessions::model::SessionEventRecord {
            id: 0,
            session_id: "target".into(),
            seq: 1,
            timestamp: "2026-08-11T00:01:00Z".into(),
            event_type: "turn_started".into(),
            turn_id: Some("turn-unrepaired".into()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.into(),
        })
        .expect("open turn");
    state
        .db
        .with_conn(|conn| {
            conn.execute_batch(
                "CREATE TRIGGER reject_startup_repair_delivery
                 BEFORE INSERT ON session_link_completion_deliveries
                 BEGIN SELECT RAISE(ABORT, 'repair blocked'); END;",
            )
        })
        .expect("install failpoint");

    assert!(state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .is_err());
    assert!(state.acp_manager.get_handle("target").await.is_none());
    assert!(CompletionDeliveryStore::new(state.db.clone())
        .list_all_for_test()
        .expect("deliveries")
        .is_empty());

    state
        .db
        .with_conn(|conn| conn.execute_batch("DROP TRIGGER reject_startup_repair_delivery;"))
        .expect("remove failpoint");
    state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("start after repair");
    assert!(state.acp_manager.get_ready_handle("target").await.is_some());
    let deliveries = CompletionDeliveryStore::new(state.db.clone())
        .list_all_for_test()
        .expect("deliveries");
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].child_turn_id, "turn-unrepaired");

    stop_target_actor(&state).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_start_joins_pending_repair_and_drains_one_queued_prompt_in_sequence() {
    const OLD_TURN_ID: &str = "turn-before-concurrent-start";
    const PROBE_TURN_ID: &str = "turn-second-start-repair-probe";
    const QUEUED_TEXT: &str = "queued exactly once after startup repair";

    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("concurrent-start-repair");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    std::fs::write(script.control_dir.join("hold-load"), b"").expect("hold session/load");
    let state = build_state(&runtime_home, Db::open_in_memory().expect("db"), true);
    let mut parent = session("repair-parent", "workspace-b", "idle", "Parent");
    parent.agent_kind = "missing-agent".into();
    state
        .session_service
        .store()
        .insert(&parent)
        .expect("parent");
    state
        .session_service
        .store()
        .seed_empty_launch_intent(&parent.id);
    state
        .subagent_service
        .link_child("repair-parent", "target", Some("worker".into()), None, None)
        .expect("link");
    let store = state.session_service.store();
    store
        .append_event(&crate::domains::sessions::model::SessionEventRecord {
            id: 0,
            session_id: "target".into(),
            seq: 1,
            timestamp: "2026-08-11T00:01:00Z".into(),
            event_type: "turn_started".into(),
            turn_id: Some(OLD_TURN_ID.into()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.into(),
        })
        .expect("open turn");
    store
        .insert_pending_prompt("target", QUEUED_TEXT, Some("queued-after-repair"))
        .expect("durable queued prompt");
    let target = store
        .find_by_id("target")
        .expect("read target")
        .expect("target");

    let first_runtime = state.session_runtime.clone();
    let first_record = target.clone();
    let first = tokio::spawn(async move {
        first_runtime
            .ensure_live_session_handle(&first_record, None)
            .await
    });
    wait_for_path(&script.control_dir.join("load-seen")).await;
    let pending_handle = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if let Some(handle) = state.acp_manager.get_handle("target").await {
                break handle;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("pending handle installed");
    assert!(pending_handle.native_session_id().is_none());
    let mut live_events = pending_handle.subscribe();

    let repaired = store.list_events("target").expect("repaired events");
    assert_eq!(
        repaired.iter().map(|event| event.seq).collect::<Vec<_>>(),
        [1, 2]
    );
    assert_eq!(repaired[1].event_type, "turn_ended");
    assert!(repaired[1].payload_json.contains("cancelled"));
    let repaired_deliveries = CompletionDeliveryStore::new(state.db.clone())
        .list_all_for_test()
        .expect("repair delivery");
    assert_eq!(repaired_deliveries.len(), 1);
    assert_eq!(repaired_deliveries[0].child_turn_id, OLD_TURN_ID);
    assert_eq!(
        repaired_deliveries[0].outcome,
        SessionTurnOutcome::Cancelled
    );

    // This row is deliberately inserted after the first start repaired, read
    // last_seq, and installed its pending handle. A second pre-manager repair
    // would see it and hit the trigger; joining the pending handle does not.
    store
        .append_event(&crate::domains::sessions::model::SessionEventRecord {
            id: 0,
            session_id: "target".into(),
            seq: 3,
            timestamp: "2026-08-11T00:02:00Z".into(),
            event_type: "turn_started".into(),
            turn_id: Some(PROBE_TURN_ID.into()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.into(),
        })
        .expect("repair probe");
    state
        .db
        .with_conn(|conn| {
            conn.execute_batch(
                "CREATE TRIGGER reject_second_start_repair
                 BEFORE INSERT ON session_link_completion_deliveries
                 BEGIN SELECT RAISE(ABORT, 'second start attempted repair'); END;",
            )
        })
        .expect("second-repair failpoint");

    let second_runtime = state.session_runtime.clone();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let mut second = tokio::spawn(async move {
        let _ = entered_tx.send(());
        second_runtime
            .ensure_live_session_handle(&target, None)
            .await
    });
    entered_rx.await.expect("second start entered");
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(200), &mut second)
            .await
            .is_err(),
        "the second start must join pending readiness instead of repairing"
    );
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "DELETE FROM session_events WHERE session_id = 'target' AND turn_id = ?1",
                [PROBE_TURN_ID],
            )?;
            conn.execute_batch("DROP TRIGGER reject_second_start_repair;")?;
            Ok(())
        })
        .expect("remove repair probe");
    std::fs::write(script.control_dir.join("release-load"), b"").expect("release session/load");

    let first_handle = tokio::time::timeout(std::time::Duration::from_secs(2), first)
        .await
        .expect("first start timeout")
        .expect("first start task")
        .expect("first start");
    let second_handle = tokio::time::timeout(std::time::Duration::from_secs(2), second)
        .await
        .expect("second start timeout")
        .expect("second start task")
        .expect("second start");
    assert!(Arc::ptr_eq(&first_handle, &second_handle));
    assert!(Arc::ptr_eq(&first_handle, &pending_handle));

    let broadcast = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        let mut events = Vec::new();
        loop {
            let envelope = live_events.recv().await.expect("live event");
            let turn_ended = matches!(&envelope.event, SessionEvent::TurnEnded(_));
            events.push(envelope);
            if turn_ended {
                break events;
            }
        }
    })
    .await
    .expect("queued prompt live terminal");
    wait_for_prompt_count(&script.request_log, 1).await;
    wait_for_queue_len(&state, 0).await;
    wait_for_actor_idle(&state).await;
    assert_eq!(broadcast.first().expect("first live event").seq, 3);
    assert!(broadcast
        .windows(2)
        .all(|pair| pair[1].seq == pair[0].seq + 1));

    wait_for("both child terminal outboxes", || {
        CompletionDeliveryStore::new(state.db.clone())
            .list_all_for_test()
            .is_ok_and(|rows| rows.len() == 2)
    })
    .await;
    let events = store.list_events("target").expect("all target events");
    assert_eq!(
        events.iter().map(|event| event.seq).collect::<Vec<_>>(),
        (1..=events.len() as i64).collect::<Vec<_>>()
    );
    let deliveries = CompletionDeliveryStore::new(state.db.clone())
        .list_all_for_test()
        .expect("terminal outboxes");
    let cancelled = deliveries
        .iter()
        .filter(|row| row.outcome == SessionTurnOutcome::Cancelled)
        .collect::<Vec<_>>();
    let completed = deliveries
        .iter()
        .filter(|row| row.outcome == SessionTurnOutcome::Completed)
        .collect::<Vec<_>>();
    assert_eq!(cancelled.len(), 1);
    assert_eq!(cancelled[0].child_turn_id, OLD_TURN_ID);
    assert_eq!(completed.len(), 1);
    let queued_turn_id = completed[0].child_turn_id.as_str();
    assert!(events.iter().any(|event| {
        event.turn_id.as_deref() == Some(queued_turn_id)
            && event.event_type == "turn_ended"
            && event.payload_json.contains("end_turn")
    }));
    assert!(!events.iter().any(|event| {
        event.turn_id.as_deref() == Some(queued_turn_id)
            && event.event_type == "turn_ended"
            && event.payload_json.contains("cancelled")
    }));

    let requests = read_requests(&script.request_log);
    assert_eq!(
        requests
            .iter()
            .filter(|request| request["method"] == "initialize")
            .count(),
        1
    );
    assert_eq!(
        requests
            .iter()
            .filter(|request| {
                request["method"] == "session/load"
                    && request["params"]["sessionId"] == "native-target"
            })
            .count(),
        1
    );
    assert_eq!(prompt_texts(&script.request_log), [QUEUED_TEXT]);

    stop_target_actor(&state).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}
