use super::fixture::{
    assert_admission_rolled_back, assert_enqueue_rolled_back, assert_final_delivery,
    assert_one_outbox_and_ledger, capture_delivery, drop_trigger_and_force_due, install_trigger,
    wait_for, wait_for_delivered, wait_for_enqueued, wait_for_failed_attempt, PARENT_ID,
};
use crate::app::test_support;
use crate::domains::sessions::runtime::prompt_message_actor_tests::{
    build_state, install_scripted_agent_env, prompt_texts, read_requests, stop_target_actor,
    temp_runtime_home, write_scripted_agent,
};
use crate::persistence::Db;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn boundary_a_restarted_worker_recovers_aborted_canonical_queue_insert_once() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("completion-boundary-a");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state_a = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file-backed db"),
        true,
    );
    install_trigger(
        &state_a.db,
        "c03_abort_queue_insert",
        "BEFORE INSERT ON session_pending_prompts
         WHEN NEW.session_id = 'target'
          AND NEW.prompt_id LIKE 'subagent_completion:%'",
        "SELECT RAISE(ABORT, 'c03 boundary A')",
    );
    let delivery = capture_delivery(&state_a, "boundary-a-delivery");
    let prompt_id = delivery.prompt_id();

    wait_for_failed_attempt(&state_a, &delivery.delivery_id).await;
    assert_enqueue_rolled_back(&state_a, &delivery.delivery_id);
    assert_one_outbox_and_ledger(&state_a, &delivery.delivery_id);
    assert!(prompt_texts(&script.request_log).is_empty());
    drop(state_a);

    drop_trigger_and_force_due(
        &runtime_home,
        "c03_abort_queue_insert",
        &delivery.delivery_id,
    );
    let state_b = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("rebuild file-backed db"),
        false,
    );
    wait_for_delivered(&state_b, &script, &delivery).await;
    assert_eq!(delivery.prompt_id(), prompt_id);
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
        0,
        "cold reconstructed parent must load its durable native session"
    );
    let cursor: i64 = state_b
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT pending_prompt_seq_cursor FROM sessions WHERE id = ?1",
                [PARENT_ID],
                |row| row.get(0),
            )
        })
        .expect("one canonical queue lifecycle");
    assert_eq!(cursor, 1);

    stop_target_actor(&state_b).await;
    drop(state_b);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn boundary_b_restarted_worker_recovers_atomic_enqueued_update_abort_once() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("completion-boundary-b");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state_a = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file-backed db"),
        true,
    );
    install_trigger(
        &state_a.db,
        "c03_abort_enqueued_update",
        "BEFORE UPDATE OF state ON session_link_completion_deliveries
         WHEN NEW.state = 'enqueued'",
        "SELECT RAISE(ABORT, 'c03 boundary B')",
    );
    let delivery = capture_delivery(&state_a, "boundary-b-delivery");
    let stable_prompt_id = delivery.prompt_id();

    wait_for_failed_attempt(&state_a, &delivery.delivery_id).await;
    assert_enqueue_rolled_back(&state_a, &delivery.delivery_id);
    assert_one_outbox_and_ledger(&state_a, &delivery.delivery_id);
    assert!(prompt_texts(&script.request_log).is_empty());
    drop(state_a);

    drop_trigger_and_force_due(
        &runtime_home,
        "c03_abort_enqueued_update",
        &delivery.delivery_id,
    );
    let state_b = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("rebuild file-backed db"),
        false,
    );
    wait_for_delivered(&state_b, &script, &delivery).await;
    assert_eq!(delivery.prompt_id(), stable_prompt_id);
    assert_final_delivery(&state_b, &script, &delivery);
    assert_eq!(prompt_texts(&script.request_log).len(), 1);
    let cursor: i64 = state_b
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT pending_prompt_seq_cursor FROM sessions WHERE id = ?1",
                [PARENT_ID],
                |row| row.get(0),
            )
        })
        .expect("one canonical queue lifecycle");
    assert_eq!(cursor, 1);

    stop_target_actor(&state_b).await;
    drop(state_b);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn boundary_c_rebuilt_actor_recovers_atomic_delivered_update_abort_once() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("completion-boundary-c");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state_a = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file-backed db"),
        true,
    );
    state_a
        .db
        .with_conn(|conn| {
            conn.execute_batch(
                "CREATE TABLE c03_admission_attempt_source (value INTEGER NOT NULL);
                 CREATE TABLE c03_admission_attempt_marker (value INTEGER NOT NULL);
                 WITH RECURSIVE values_to_512(value) AS (
                     SELECT 1 UNION ALL SELECT value + 1 FROM values_to_512 WHERE value < 512
                 )
                 INSERT INTO c03_admission_attempt_source SELECT value FROM values_to_512;",
            )
        })
        .expect("install transaction-local admission attempt marker");
    install_trigger(
        &state_a.db,
        "c03_abort_delivered_update",
        "BEFORE UPDATE OF state ON session_link_completion_deliveries
         WHEN NEW.state = 'delivered'",
        "INSERT INTO c03_admission_attempt_marker
             SELECT value FROM c03_admission_attempt_source;
         SELECT RAISE(ABORT, 'c03 boundary C')",
    );
    std::fs::write(script.control_dir.join("hold-load"), b"").expect("hold actor before admission");
    let delivery = capture_delivery(&state_a, "boundary-c-delivery");
    let stable_prompt_id = delivery.prompt_id();

    wait_for_enqueued(&state_a, &delivery.delivery_id).await;
    wait_for("parent ACP load blocked before admission", || {
        script.control_dir.join("load-seen").exists()
    })
    .await;
    let changes_before_admission = state_a
        .db
        .with_conn(|conn| Ok(conn.total_changes()))
        .expect("changes before admission");
    std::fs::write(script.control_dir.join("release-load"), b"")
        .expect("release parent load into admission");
    wait_for("aborted Delivered update trigger", || {
        state_a
            .db
            .with_conn(|conn| Ok(conn.total_changes()))
            .is_ok_and(|changes| changes >= changes_before_admission + 512)
    })
    .await;
    let marker_count: i64 = state_a
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM c03_admission_attempt_marker",
                [],
                |row| row.get(0),
            )
        })
        .expect("rolled-back trigger marker");
    assert_eq!(
        marker_count, 0,
        "trigger side effects roll back with admission"
    );
    assert_admission_rolled_back(&state_a, &delivery.delivery_id);
    assert!(prompt_texts(&script.request_log).is_empty());
    stop_target_actor(&state_a).await;
    assert_admission_rolled_back(&state_a, &delivery.delivery_id);
    drop(state_a);

    drop_trigger_and_force_due(
        &runtime_home,
        "c03_abort_delivered_update",
        &delivery.delivery_id,
    );
    let state_b = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("rebuild file-backed db"),
        false,
    );
    wait_for_delivered(&state_b, &script, &delivery).await;
    assert_eq!(delivery.prompt_id(), stable_prompt_id);
    assert_final_delivery(&state_b, &script, &delivery);
    assert_eq!(prompt_texts(&script.request_log).len(), 1);
    let cursor: i64 = state_b
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT pending_prompt_seq_cursor FROM sessions WHERE id = ?1",
                [PARENT_ID],
                |row| row.get(0),
            )
        })
        .expect("one canonical queue lifecycle");
    assert_eq!(cursor, 1);
    assert_eq!(
        read_requests(&script.request_log)
            .iter()
            .filter(|request| request["method"] == "session/load")
            .count(),
        2,
        "both pre-crash and rebuilt actors load the same durable parent"
    );

    stop_target_actor(&state_b).await;
    drop(state_b);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}
