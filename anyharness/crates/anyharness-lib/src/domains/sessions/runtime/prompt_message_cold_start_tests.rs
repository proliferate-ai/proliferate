use super::prompt_message_actor_tests::{
    assert_agent_output, build_state, install_scripted_agent_env, prompt_texts, read_requests,
    send_message, stop_target_actor, temp_runtime_home, wait_for_actor_idle, wait_for_prompt_count,
    wait_for_queue_len, write_scripted_agent,
};
use crate::app::test_support;
use crate::persistence::Db;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_message_cold_target_loads_recorded_native_id_and_drains_exactly_once() {
    let _env_lock = test_support::lock_env();
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
