use super::fixture::{
    assert_final_delivery_after_link_loss, capture_delivery, drop_trigger_and_force_due,
    install_trigger, wait_for_delivered, CHILD_ID, PARENT_ID,
};
use crate::app::test_support;
use crate::domains::sessions::runtime::prompt_message_actor_tests::{
    build_state, install_scripted_agent_env, stop_target_actor, temp_runtime_home,
    write_scripted_agent,
};
use crate::domains::sessions::subagents::delivery::CompletionDeliveryStore;
use crate::persistence::Db;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn captured_delivery_survives_child_graph_deletion_but_parent_deletion_removes_it() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("completion-deletion-direction");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state_a = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file-backed db"),
        true,
    );
    install_trigger(
        &state_a.db,
        "c03_hold_delivery_for_child_delete",
        "AFTER INSERT ON session_link_completion_deliveries",
        "UPDATE session_link_completion_deliveries
         SET next_attempt_at = '2999-01-01T00:00:00Z'
         WHERE delivery_id = NEW.delivery_id",
    );
    let delivery = capture_delivery(&state_a, "deletion-direction-delivery");
    let stable_prompt_id = delivery.prompt_id();
    let delivery_store = CompletionDeliveryStore::new(state_a.db.clone());
    assert!(delivery_store
        .ensure_completion_projection(&delivery)
        .expect("materialize completion ledger before child deletion"));
    let ledger_before_delete: i64 = state_a
        .db
        .with_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                row.get(0)
            })
        })
        .expect("ledger before child deletion");
    assert_eq!(ledger_before_delete, 1);

    state_a
        .session_service
        .delete_session(CHILD_ID)
        .expect("real child session graph deletion");
    assert!(state_a
        .session_service
        .get_session(CHILD_ID)
        .expect("deleted child lookup")
        .is_none());
    let (link_count, ledger_count): (i64, i64) = state_a
        .db
        .with_conn(|conn| {
            Ok((
                conn.query_row("SELECT COUNT(*) FROM session_links", [], |row| row.get(0))?,
                conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                    row.get(0)
                })?,
            ))
        })
        .expect("child graph counts");
    assert_eq!((link_count, ledger_count), (0, 0));
    let surviving = CompletionDeliveryStore::new(state_a.db.clone())
        .find(&delivery.delivery_id)
        .expect("surviving delivery lookup")
        .expect("captured delivery survives child deletion");
    assert_eq!(surviving.prompt_id(), stable_prompt_id);
    drop(state_a);

    drop_trigger_and_force_due(
        &runtime_home,
        "c03_hold_delivery_for_child_delete",
        &delivery.delivery_id,
    );
    let state_b = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("rebuild after child deletion"),
        false,
    );
    wait_for_delivered(&state_b, &script, &delivery).await;
    assert_final_delivery_after_link_loss(&state_b, &script, &delivery);
    assert_eq!(
        crate::domains::sessions::runtime::prompt_message_actor_tests::prompt_texts(
            &script.request_log,
        )
        .len(),
        1
    );

    stop_target_actor(&state_b).await;
    state_b
        .session_service
        .delete_session(PARENT_ID)
        .expect("real parent session graph deletion");
    assert!(state_b
        .session_service
        .get_session(PARENT_ID)
        .expect("deleted parent lookup")
        .is_none());
    assert!(CompletionDeliveryStore::new(state_b.db.clone())
        .list_all_for_test()
        .expect("outbox after parent deletion")
        .is_empty());

    drop(state_b);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}
