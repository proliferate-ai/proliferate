use std::sync::{Arc, Barrier};

use super::fixture::{
    assert_final_delivery, capture_delivery, install_trigger, wait_for_delivered,
};
use crate::app::test_support;
use crate::domains::sessions::runtime::prompt_message_actor_tests::{
    build_state, install_scripted_agent_env, prompt_texts, stop_target_actor, temp_runtime_home,
    write_scripted_agent,
};
use crate::domains::sessions::store::completion_deliveries::enqueue::ClaimedDeliveryEnqueueOutcome;
use crate::domains::sessions::subagents::delivery::CompletionDeliveryStore;
use crate::persistence::Db;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_claim_has_one_winner_and_expired_foreign_lease_recovers_once() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("completion-concurrent-claim");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state_a = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file-backed db"),
        true,
    );
    install_trigger(
        &state_a.db,
        "c03_hold_new_delivery",
        "AFTER INSERT ON session_link_completion_deliveries",
        "UPDATE session_link_completion_deliveries
         SET next_attempt_at = '2999-01-01T00:00:00Z'
         WHERE delivery_id = NEW.delivery_id",
    );
    let delivery = capture_delivery(&state_a, "concurrent-claim-delivery");
    drop(state_a);

    let setup_db = Db::open(&runtime_home).expect("reopen claim db");
    setup_db
        .with_conn(|conn| {
            conn.execute_batch("DROP TRIGGER c03_hold_new_delivery;")?;
            conn.execute(
                "UPDATE session_link_completion_deliveries
                 SET next_attempt_at = '2026-08-11T00:02:00Z'
                 WHERE delivery_id = ?1",
                [&delivery.delivery_id],
            )?;
            Ok(())
        })
        .expect("make delivery concurrently claimable");
    drop(setup_db);

    let barrier = Arc::new(Barrier::new(3));
    let mut claims = Vec::new();
    for token in ["foreign-worker-a", "foreign-worker-b"] {
        let runtime_home = runtime_home.clone();
        let barrier = barrier.clone();
        claims.push(std::thread::spawn(move || {
            let db = Db::open(&runtime_home).expect("independent claim store");
            db.with_conn(|conn| conn.busy_timeout(std::time::Duration::from_secs(2)))
                .expect("bounded concurrent SQLite wait");
            let store = CompletionDeliveryStore::new(db);
            barrier.wait();
            // Retry on a time budget, not an iteration count: yield_now-style
            // spinning burns all 1,000 attempts in well under a millisecond on
            // a busy 2-vCPU CI runner, faster than the winner's write
            // transaction commits on CI disk.
            let claimed = (0..1_000)
                .find_map(|_| {
                    match store.claim_next_due(
                        "2026-08-11T00:03:00Z",
                        "2026-08-11T00:33:00Z",
                        token,
                    ) {
                        Ok(claimed) => Some(claimed),
                        Err(error) if sqlite_is_busy(&error) => {
                            std::thread::sleep(std::time::Duration::from_millis(2));
                            None
                        }
                        Err(error) => panic!("concurrent claim: {error:#}"),
                    }
                })
                .expect("concurrent SQLite claim eventually resolves");
            (token.to_string(), claimed)
        }));
    }
    barrier.wait();
    let results = claims
        .into_iter()
        .map(|claim| claim.join().expect("claim thread"))
        .collect::<Vec<_>>();
    assert_eq!(
        results.iter().filter(|(_, row)| row.is_some()).count(),
        1,
        "SQLite claim transaction elects exactly one worker"
    );
    let (foreign_token, foreign_claim) = results
        .into_iter()
        .find(|(_, row)| row.is_some())
        .expect("winning foreign claim");
    let foreign_claim = foreign_claim.expect("claimed record");
    assert_eq!(foreign_claim.delivery_id, delivery.delivery_id);
    assert_eq!(foreign_claim.attempt_count, 1);
    assert_eq!(
        foreign_claim.lease_token.as_deref(),
        Some(foreign_token.as_str())
    );

    let expired_db = Db::open(&runtime_home).expect("expire foreign lease db");
    expired_db
        .with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE session_link_completion_deliveries
                 SET lease_expires_at = '1970-01-01T00:00:00Z',
                     next_attempt_at = '1970-01-01T00:00:00Z'
                 WHERE delivery_id = ?1 AND lease_token = ?2",
                rusqlite::params![delivery.delivery_id, foreign_token],
            )?;
            assert_eq!(changed, 1);
            Ok(())
        })
        .expect("expire foreign lease");
    drop(expired_db);

    let state_b = build_state(
        &runtime_home,
        Db::open(&runtime_home).expect("rebuild worker db"),
        false,
    );
    wait_for_delivered(&state_b, &script, &delivery).await;
    assert_final_delivery(&state_b, &script, &delivery);
    assert_eq!(prompt_texts(&script.request_log).len(), 1);
    let delivered = CompletionDeliveryStore::new(state_b.db.clone())
        .find(&delivery.delivery_id)
        .expect("delivered lookup")
        .expect("delivered row");
    assert_eq!(
        delivered.attempt_count, 2,
        "expired lease was reclaimed once"
    );

    let stale = CompletionDeliveryStore::new(state_b.db.clone())
        .enqueue_claimed_canonical(
            &delivery.delivery_id,
            &foreign_token,
            "2026-08-11T00:04:00Z",
            "2026-08-11T00:04:02Z",
        )
        .expect("stale post-admission worker");
    assert!(matches!(stale, ClaimedDeliveryEnqueueOutcome::Stale));
    assert!(state_b
        .session_service
        .store()
        .list_pending_prompts("target")
        .expect("queue after stale worker")
        .is_empty());
    assert_eq!(
        prompt_texts(&script.request_log)
            .iter()
            .filter(|text| *text == &delivery.notification_text)
            .count(),
        1
    );

    stop_target_actor(&state_b).await;
    drop(state_b);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

fn sqlite_is_busy(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<rusqlite::Error>(),
        Some(rusqlite::Error::SqliteFailure(inner, _))
            if matches!(
                inner.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            )
    )
}
