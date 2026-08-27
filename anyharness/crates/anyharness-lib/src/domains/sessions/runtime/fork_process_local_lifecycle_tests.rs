use super::fork_scenario_fixtures_tests::{
    before_user_message, build_fork_runtime_state, close_all, seed_parent,
    seed_three_turn_transcript, write_fork_agent,
};
use super::prompt_message_actor_tests::{
    install_scripted_agent_env, read_requests, temp_runtime_home,
};
use super::ForkSessionError;
use crate::app::test_support;
use crate::domains::sessions::model::ForkOperationPhase;
use crate::persistence::Db;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn explicit_provider_fork_error_is_failed_and_same_key_retry_reports_errored_child() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-explicit-error");
    let script = write_fork_agent(&runtime_home, "strict");
    let _guards = install_scripted_agent_env(&script);
    let state = build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let parent_id = seed_parent(&state, Some(r#"{"fork":true,"targetedFork":true}"#));
    seed_three_turn_transcript(&state, &parent_id);
    state
        .session_runtime
        .ensure_live_session(&parent_id, None)
        .await
        .expect("start parent");
    std::fs::write(script.control_dir.join("fork-explicit-error"), b"")
        .expect("arm explicit fork error");

    let first = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("explicit-error-child".to_string()),
            None,
        )
        .await
        .expect_err("explicit provider error must fail startup");
    assert!(matches!(first, ForkSessionError::StartFailed { .. }));
    let operation = state
        .session_service
        .store()
        .find_fork_operation_by_key("explicit-error-child")
        .expect("query operation")
        .expect("operation exists");
    assert_eq!(operation.phase, ForkOperationPhase::Failed);
    assert_eq!(
        state
            .session_service
            .get_session("explicit-error-child")
            .expect("get child")
            .expect("child exists")
            .status,
        "errored"
    );

    let reconciled = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("explicit-error-child".to_string()),
            None,
        )
        .await
        .expect("same-key failed operation reconciles");
    assert!(!reconciled.child_started);
    assert_eq!(
        read_requests(&script.request_log)
            .iter()
            .filter(|request| request["method"] == "session/fork")
            .count(),
        1,
        "same-key retry must not redispatch"
    );

    close_all(&state, &[parent_id.as_str()]).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dropped_fork_response_parks_unknown_and_same_key_retry_never_redispatches() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-dropped-response");
    let script = write_fork_agent(&runtime_home, "strict");
    let _guards = install_scripted_agent_env(&script);
    let state = build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let parent_id = seed_parent(&state, Some(r#"{"fork":true,"targetedFork":true}"#));
    seed_three_turn_transcript(&state, &parent_id);
    state
        .session_runtime
        .ensure_live_session(&parent_id, None)
        .await
        .expect("start parent");
    std::fs::write(script.control_dir.join("fork-drop"), b"").expect("arm dropped response");

    let first = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("unknown-outcome-child".to_string()),
            None,
        )
        .await
        .expect_err("dropped response must fail startup");
    assert!(matches!(first, ForkSessionError::StartFailed { .. }));
    let operation = state
        .session_service
        .store()
        .find_fork_operation_by_key("unknown-outcome-child")
        .expect("query operation")
        .expect("operation exists");
    assert_eq!(operation.phase, ForkOperationPhase::NativeOutcomeUnknown);
    assert_eq!(
        state
            .session_service
            .get_session("unknown-outcome-child")
            .expect("get child")
            .expect("child exists")
            .status,
        "errored"
    );

    let retry = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("unknown-outcome-child".to_string()),
            None,
        )
        .await
        .expect_err("unknown outcome must block same-key retry");
    assert!(matches!(retry, ForkSessionError::NativeOutcomeUnknown));
    assert_eq!(
        read_requests(&script.request_log)
            .iter()
            .filter(|request| request["method"] == "session/fork")
            .count(),
        1,
        "unknown same-key retry must not redispatch"
    );

    close_all(&state, &[parent_id.as_str()]).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn malformed_fork_result_parks_unknown_and_same_key_retry_never_redispatches() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-malformed-response");
    let script = write_fork_agent(&runtime_home, "strict");
    let _guards = install_scripted_agent_env(&script);
    let state = build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let parent_id = seed_parent(&state, Some(r#"{"fork":true,"targetedFork":true}"#));
    seed_three_turn_transcript(&state, &parent_id);
    state
        .session_runtime
        .ensure_live_session(&parent_id, None)
        .await
        .expect("start parent");
    std::fs::write(script.control_dir.join("fork-malformed-result"), b"")
        .expect("arm malformed result");

    let first = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("malformed-outcome-child".to_string()),
            None,
        )
        .await
        .expect_err("malformed result must fail startup");
    assert!(matches!(first, ForkSessionError::StartFailed { .. }));
    let operation = state
        .session_service
        .store()
        .find_fork_operation_by_key("malformed-outcome-child")
        .expect("query operation")
        .expect("operation exists");
    assert_eq!(operation.phase, ForkOperationPhase::NativeOutcomeUnknown);
    assert_eq!(
        state
            .session_service
            .get_session("malformed-outcome-child")
            .expect("get child")
            .expect("child exists")
            .status,
        "errored"
    );

    let retry = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("malformed-outcome-child".to_string()),
            None,
        )
        .await
        .expect_err("malformed outcome must block same-key retry");
    assert!(matches!(retry, ForkSessionError::NativeOutcomeUnknown));
    assert_eq!(
        read_requests(&script.request_log)
            .iter()
            .filter(|request| request["method"] == "session/fork")
            .count(),
        1,
        "malformed same-key retry must not redispatch"
    );

    close_all(&state, &[parent_id.as_str()]).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn malformed_typed_fork_success_parks_unknown_without_persisting_or_redispatching() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-malformed-typed-success");
    let script = write_fork_agent(&runtime_home, "strict");
    let _guards = install_scripted_agent_env(&script);
    let state = build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let parent_id = seed_parent(&state, Some(r#"{"fork":true,"targetedFork":true}"#));
    seed_three_turn_transcript(&state, &parent_id);
    state
        .session_runtime
        .ensure_live_session(&parent_id, None)
        .await
        .expect("start parent");
    std::fs::write(script.control_dir.join("fork-malformed-typed-result"), b"")
        .expect("arm malformed typed result");

    let first = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("malformed-typed-child".to_string()),
            None,
        )
        .await
        .expect_err("malformed typed success must fail startup");
    assert!(matches!(first, ForkSessionError::StartFailed { .. }));
    let operation = state
        .session_service
        .store()
        .find_fork_operation_by_key("malformed-typed-child")
        .expect("query operation")
        .expect("operation exists");
    assert_eq!(operation.phase, ForkOperationPhase::NativeOutcomeUnknown);
    assert!(operation.native_child_session_id.is_none());
    let child = state
        .session_service
        .get_session("malformed-typed-child")
        .expect("get child")
        .expect("child exists");
    assert_eq!(child.status, "errored");
    assert!(child.native_session_id.is_none());

    let retry = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("malformed-typed-child".to_string()),
            None,
        )
        .await
        .expect_err("unknown typed outcome must block same-key retry");
    assert!(matches!(retry, ForkSessionError::NativeOutcomeUnknown));
    assert_eq!(
        read_requests(&script.request_log)
            .iter()
            .filter(|request| request["method"] == "session/fork")
            .count(),
        1,
        "malformed typed same-key retry must not redispatch"
    );

    close_all(&state, &[parent_id.as_str()]).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn malformed_wire_after_claim_parks_unknown_and_never_redispatches() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-malformed-wire");
    let script = write_fork_agent(&runtime_home, "strict");
    let _guards = install_scripted_agent_env(&script);
    let state = build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let parent_id = seed_parent(&state, Some(r#"{"fork":true,"targetedFork":true}"#));
    seed_three_turn_transcript(&state, &parent_id);
    state
        .session_runtime
        .ensure_live_session(&parent_id, None)
        .await
        .expect("start parent");
    std::fs::write(script.control_dir.join("fork-malformed-wire"), b"")
        .expect("arm malformed wire");

    let first = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("malformed-wire-child".to_string()),
            None,
        )
        .await
        .expect_err("malformed wire after dispatch must fail startup");
    assert!(matches!(first, ForkSessionError::StartFailed { .. }));
    let operation = state
        .session_service
        .store()
        .find_fork_operation_by_key("malformed-wire-child")
        .expect("query operation")
        .expect("operation exists");
    assert_eq!(operation.phase, ForkOperationPhase::NativeOutcomeUnknown);
    assert_eq!(
        state
            .session_service
            .get_session("malformed-wire-child")
            .expect("get child")
            .expect("child exists")
            .status,
        "errored"
    );

    let retry = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("malformed-wire-child".to_string()),
            None,
        )
        .await
        .expect_err("malformed wire outcome must block same-key retry");
    assert!(matches!(retry, ForkSessionError::NativeOutcomeUnknown));
    assert_eq!(
        read_requests(&script.request_log)
            .iter()
            .filter(|request| request["method"] == "session/fork")
            .count(),
        1,
        "malformed wire same-key retry must not redispatch"
    );

    close_all(&state, &[parent_id.as_str()]).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}
