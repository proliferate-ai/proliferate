use super::prompt_message_actor_tests::{
    assert_agent_output, build_state, install_scripted_agent_env, prompt_texts, read_requests,
    send_message, stop_target_actor, temp_runtime_home, wait_for_actor_idle, wait_for_prompt_count,
    wait_for_queue_len, write_scripted_agent,
};
use crate::app::test_support;
use crate::domains::sessions::prompt::{provenance::PromptProvenance, PromptPayload};
use crate::persistence::Db;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_message_cold_target_loads_recorded_native_id_and_drains_exactly_once() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("cold-send");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file-backed db"),
        true,
    );

    let target = state
        .session_service
        .get_session("target")
        .expect("load target")
        .expect("durable target");
    assert_eq!(target.native_session_id.as_deref(), Some("native-target"));
    assert!(
        target.last_prompt_at.is_some(),
        "the fixture must force native-session load instead of fresh creation"
    );
    assert!(state.acp_manager.get_handle("target").await.is_none());

    let receipt = send_message(&state, "cold activation message")
        .await
        .expect("cold send_message receipt");
    wait_for_prompt_count(&script.request_log, 1).await;
    wait_for_queue_len(&state, 0).await;
    wait_for_actor_idle(&state).await;

    let requests = read_requests(&script.request_log);
    let loads = requests
        .iter()
        .filter(|request| request["method"] == "session/load")
        .collect::<Vec<_>>();
    assert_eq!(loads.len(), 1);
    assert_eq!(loads[0]["params"]["sessionId"], "native-target");
    assert_eq!(
        requests
            .iter()
            .filter(|request| request["method"] == "session/new")
            .count(),
        0
    );
    assert_eq!(
        prompt_texts(&script.request_log),
        ["cold activation message"]
    );
    assert!(state
        .session_service
        .store()
        .find_pending_prompt("target", receipt.queue_seq)
        .expect("read committed row after drain")
        .is_none());
    assert_agent_output(&state, &["cold activation message"]);

    stop_target_actor(&state).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn startup_drain_persists_pending_prompt_added_before_executing_agent_message() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("cold-prequeued-identity");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file-backed db"),
        true,
    );
    let store = state.session_service.store();
    let pending = store
        .insert_pending_prompt_payload(
            "target",
            &PromptPayload::text("prequeued child result".into()).with_provenance(
                PromptProvenance::AgentSession {
                    source_session_id: "child-1".into(),
                    session_link_id: Some("link-1".into()),
                    label: Some("worker".into()),
                },
            ),
            None,
        )
        .expect("commit child message without activation");
    assert!(!store
        .has_pending_prompt_added_event(&pending)
        .expect("no visibility event before startup"));
    assert!(state.acp_manager.get_handle("target").await.is_none());

    state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("start target actor");
    wait_for_prompt_count(&script.request_log, 1).await;
    wait_for_queue_len(&state, 0).await;
    wait_for_actor_idle(&state).await;

    let queue_events = store
        .list_events("target")
        .expect("target events")
        .into_iter()
        .filter(|event| {
            matches!(
                event.event_type.as_str(),
                "pending_prompt_added" | "pending_prompt_removed"
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        queue_events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>(),
        vec!["pending_prompt_added", "pending_prompt_removed"]
    );
    let added: serde_json::Value =
        serde_json::from_str(&queue_events[0].payload_json).expect("added payload");
    let removed: serde_json::Value =
        serde_json::from_str(&queue_events[1].payload_json).expect("removed payload");
    assert_eq!(added["seq"], pending.seq);
    assert_eq!(added["queuedAt"], pending.queued_at);
    assert_eq!(added["promptProvenance"]["sourceSessionId"], "child-1");
    assert_eq!(removed["seq"], pending.seq);
    assert_eq!(removed["reason"], "executed");
    assert_eq!(
        prompt_texts(&script.request_log),
        ["prequeued child result"]
    );

    stop_target_actor(&state).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}
