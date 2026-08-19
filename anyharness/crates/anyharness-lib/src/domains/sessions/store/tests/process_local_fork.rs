use super::{fork_link_record, seed_workspace, session_record, SessionStore};
use crate::domains::sessions::model::{ForkOperationPhase, ForkOperationRecord};
use crate::domains::sessions::store::fork_operations::ForkOperationChildResult;
use crate::persistence::Db;

const NOW: &str = "2026-08-19T00:00:00Z";

fn setup() -> (Db, SessionStore) {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db.clone());
    let mut parent = session_record();
    parent.id = "parent".to_string();
    parent.native_session_id = Some("native-parent".to_string());
    store.insert(&parent).expect("insert parent");
    (db, store)
}

fn insert_prepared(store: &SessionStore, suffix: &str) -> (String, String) {
    let operation_id = format!("operation-{suffix}");
    let child_id = format!("child-{suffix}");
    store
        .insert_fork_operation(&ForkOperationRecord {
            id: operation_id.clone(),
            idempotency_key: format!("key-{suffix}"),
            request_digest: format!("digest-{suffix}"),
            parent_session_id: "parent".to_string(),
            child_session_id: child_id.clone(),
            phase: ForkOperationPhase::Prepared,
            anchor_turn_id: None,
            anchor_item_id: None,
            provider_anchor_kind: None,
            provider_anchor_value: None,
            provider_anchor_inclusive: None,
            prefix_terminal_seq: Some(0),
            prefix_digest: Some(format!("prefix-{suffix}")),
            adapter_version: None,
            native_version: None,
            native_child_session_id: None,
            checkpoint_id: None,
            created_at: NOW.to_string(),
            updated_at: NOW.to_string(),
        })
        .expect("insert operation");
    let mut child = session_record();
    child.id = child_id.clone();
    child.native_session_id = None;
    child.status = "starting".to_string();
    let link = fork_link_record(&format!("link-{suffix}"), "parent", &child_id);
    store
        .insert_prepared_process_local_fork_child_with_link(
            &child,
            &link,
            &operation_id,
            &ForkOperationChildResult {
                prefix_terminal_seq: Some(0),
                prefix_digest: Some(format!("prefix-{suffix}")),
                ..ForkOperationChildResult::default()
            },
            NOW,
        )
        .expect("insert prepared child");
    (operation_id, child_id)
}

fn operation(store: &SessionStore, child_id: &str) -> ForkOperationRecord {
    store
        .find_fork_operation_by_child(child_id)
        .expect("query operation")
        .expect("operation exists")
}

#[test]
fn native_call_claim_requires_exact_operation_child_pair_and_is_single_use() {
    let (_db, store) = setup();
    let (operation_a, child_a) = insert_prepared(&store, "a");
    let (_operation_b, child_b) = insert_prepared(&store, "b");

    assert!(store
        .claim_process_local_fork_native_call(&operation_a, &child_b, NOW)
        .is_err());
    assert_eq!(
        operation(&store, &child_a).phase,
        ForkOperationPhase::Prepared
    );
    assert_eq!(
        operation(&store, &child_b).phase,
        ForkOperationPhase::Prepared
    );

    store
        .claim_process_local_fork_native_call(&operation_a, &child_a, NOW)
        .expect("claim exact operation and child");
    assert!(store
        .claim_process_local_fork_native_call(&operation_a, &child_a, NOW)
        .is_err());
    assert_eq!(
        operation(&store, &child_a).phase,
        ForkOperationPhase::NativeCallInFlight
    );
}

#[test]
fn native_result_transaction_rolls_back_session_when_operation_update_fails() {
    let (db, store) = setup();
    let (operation_id, child_id) = insert_prepared(&store, "result");
    store
        .claim_process_local_fork_native_call(&operation_id, &child_id, NOW)
        .expect("claim");
    db.with_conn(|conn| {
        conn.execute_batch(
            "CREATE TRIGGER reject_process_local_result
             BEFORE UPDATE OF phase ON fork_operations
             WHEN NEW.id = 'operation-result' AND NEW.phase = 'native_result_known'
             BEGIN SELECT RAISE(FAIL, 'injected result failure'); END;",
        )
    })
    .expect("install result failure");

    assert!(store
        .record_process_local_fork_native_result(&operation_id, &child_id, "native-child", NOW,)
        .is_err());
    assert!(store
        .find_by_id(&child_id)
        .expect("get child")
        .expect("child exists")
        .native_session_id
        .is_none());
    assert_eq!(
        operation(&store, &child_id).phase,
        ForkOperationPhase::NativeCallInFlight
    );

    db.with_conn(|conn| conn.execute_batch("DROP TRIGGER reject_process_local_result"))
        .expect("drop result failure");
    store
        .record_process_local_fork_native_result(&operation_id, &child_id, "native-child", NOW)
        .expect("record result");
    let child = store
        .find_by_id(&child_id)
        .expect("get child")
        .expect("child exists");
    assert_eq!(child.native_session_id.as_deref(), Some("native-child"));
    let operation = operation(&store, &child_id);
    assert_eq!(operation.phase, ForkOperationPhase::NativeResultKnown);
    assert!(operation.native_child_session_id.is_none());
}

#[test]
fn ready_finalization_transaction_rolls_back_idle_when_completion_fails() {
    let (db, store) = setup();
    let (operation_id, child_id) = insert_prepared(&store, "finalize");
    store
        .claim_process_local_fork_native_call(&operation_id, &child_id, NOW)
        .expect("claim");
    store
        .record_process_local_fork_native_result(&operation_id, &child_id, "native-child", NOW)
        .expect("record result");
    db.with_conn(|conn| {
        conn.execute_batch(
            "CREATE TRIGGER reject_process_local_completion
             BEFORE UPDATE OF phase ON fork_operations
             WHEN NEW.id = 'operation-finalize' AND NEW.phase = 'completed'
             BEGIN SELECT RAISE(FAIL, 'injected completion failure'); END;",
        )
    })
    .expect("install completion failure");

    assert!(store
        .finalize_process_local_fork_startup(&operation_id, &child_id, "native-child", NOW,)
        .is_err());
    assert_eq!(
        store
            .find_by_id(&child_id)
            .expect("get child")
            .expect("child exists")
            .status,
        "starting"
    );
    assert_eq!(
        operation(&store, &child_id).phase,
        ForkOperationPhase::NativeResultKnown
    );

    db.with_conn(|conn| conn.execute_batch("DROP TRIGGER reject_process_local_completion"))
        .expect("drop completion failure");
    store
        .finalize_process_local_fork_startup(&operation_id, &child_id, "native-child", NOW)
        .expect("finalize");
    assert_eq!(
        store
            .find_by_id(&child_id)
            .expect("get child")
            .expect("child exists")
            .status,
        "idle"
    );
    assert_eq!(
        operation(&store, &child_id).phase,
        ForkOperationPhase::Completed
    );
}

#[test]
fn definite_and_ambiguous_in_flight_failures_are_durably_distinct() {
    let (_db, store) = setup();
    let (failed_operation, failed_child) = insert_prepared(&store, "failed");
    let (unknown_operation, unknown_child) = insert_prepared(&store, "unknown");
    store
        .claim_process_local_fork_native_call(&failed_operation, &failed_child, NOW)
        .expect("claim failed case");
    store
        .claim_process_local_fork_native_call(&unknown_operation, &unknown_child, NOW)
        .expect("claim unknown case");

    store
        .fail_in_flight_process_local_fork(&failed_operation, &failed_child, NOW)
        .expect("terminalize explicit failure");
    store
        .park_process_local_fork_native_outcome_unknown(&unknown_operation, &unknown_child, NOW)
        .expect("park ambiguous outcome");

    assert_eq!(
        operation(&store, &failed_child).phase,
        ForkOperationPhase::Failed
    );
    assert_eq!(
        operation(&store, &unknown_child).phase,
        ForkOperationPhase::NativeOutcomeUnknown
    );
    for child_id in [failed_child, unknown_child] {
        assert_eq!(
            store
                .find_by_id(&child_id)
                .expect("get child")
                .expect("child exists")
                .status,
            "errored"
        );
    }
}
