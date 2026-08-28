use super::fixture::{
    assert_final_delivery, capture_delivery, drop_trigger_and_force_due, install_trigger, wait_for,
    wait_for_delivered, wait_for_enqueued,
};
use crate::app::test_support;
use crate::domains::sessions::runtime::prompt_message_actor_tests::{
    build_state, install_scripted_agent_env, prompt_texts, read_requests, send_message,
    stop_target_actor, temp_runtime_home, wait_for_actor_idle, write_scripted_agent,
};
use crate::persistence::Db;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn idle_live_parent_delivers_completion_once() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("completion-idle-parent");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file-backed db"),
        true,
    );
    state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("start idle parent actor");
    wait_for_actor_idle(&state).await;

    let delivery = capture_delivery(&state, "idle-parent-delivery");
    wait_for_delivered(&state, &script, &delivery).await;
    assert_final_delivery(&state, &script, &delivery);
    assert_eq!(
        prompt_texts(&script.request_log),
        std::slice::from_ref(&delivery.notification_text)
    );

    stop_target_actor(&state).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cold_reconstructed_parent_loads_without_creating_a_new_provider_session() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("completion-cold-parent");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state_a = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file-backed db"),
        true,
    );
    install_trigger(
        &state_a.db,
        "c03_hold_delivery_for_cold_parent",
        "AFTER INSERT ON session_link_completion_deliveries",
        "UPDATE session_link_completion_deliveries
         SET next_attempt_at = '2999-01-01T00:00:00Z'
         WHERE delivery_id = NEW.delivery_id",
    );
    let delivery = capture_delivery(&state_a, "cold-parent-delivery");
    drop(state_a);

    drop_trigger_and_force_due(
        &runtime_home,
        "c03_hold_delivery_for_cold_parent",
        &delivery.delivery_id,
    );
    let state_b = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("rebuild cold parent db"),
        false,
    );
    wait_for_delivered(&state_b, &script, &delivery).await;
    assert_final_delivery(&state_b, &script, &delivery);
    let requests = read_requests(&script.request_log);
    assert_eq!(
        requests
            .iter()
            .filter(|request| request["method"] == "session/load")
            .count(),
        1
    );
    assert_eq!(
        requests
            .iter()
            .filter(|request| request["method"] == "session/new")
            .count(),
        0
    );
    assert_eq!(prompt_texts(&script.request_log).len(), 1);

    stop_target_actor(&state_b).await;
    drop(state_b);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn running_parent_preserves_blocking_turn_then_completion_fifo() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("completion-running-parent");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file-backed db"),
        true,
    );
    send_message(&state, "blocking turn")
        .await
        .expect("start deterministic blocking turn");
    wait_for("blocking provider turn", || {
        script.control_dir.join("turn-seen").exists()
    })
    .await;

    let delivery = capture_delivery(&state, "running-parent-delivery");
    wait_for_enqueued(&state, &delivery.delivery_id).await;
    assert_eq!(
        prompt_texts(&script.request_log),
        ["blocking turn"],
        "completion stays queued while the parent provider turn is running"
    );

    std::fs::write(script.control_dir.join("release-turn"), b"")
        .expect("release blocking provider turn");
    wait_for_delivered(&state, &script, &delivery).await;
    wait_for_actor_idle(&state).await;
    assert_eq!(
        prompt_texts(&script.request_log),
        ["blocking turn", delivery.notification_text.as_str()]
    );
    assert_final_delivery(&state, &script, &delivery);

    stop_target_actor(&state).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}
