//! Forks ADR rung 3 targeted-fork wire-in: end-to-end scenario tests driving a
//! real scripted stdio ACP agent subprocess over real file-/memory-backed
//! sqlite (fixtures in `fork_scenario_fixtures`). These pin the runtime-side
//! dispatch seams the pure gate/anchor tests (`fork_anchor_gate_tests`,
//! `launch_policy`, `startup_facts`) only cover in isolation: the derived
//! provider anchor actually rides the outbound `session/fork` wire request,
//! its durable provenance coexists with an exact checkpoint link after child
//! persistence,
//! the shipped legacy probe still fails closed for a targeted request, a cold
//! restart refuses a targeted child whose recorded anchor is missing, and a
//! concurrent same-key double fork never duplicates the child.

use std::sync::Arc;

use super::fork_scenario_fixtures_tests::{
    assert_child_anchor_provenance, assert_process_local_fork_wire_contract, before_user_message,
    build_fork_runtime_state, close_all, fork_children, fork_wire_anchors, seed_fork_child,
    seed_parent, seed_three_turn_transcript, wait_for_child_notification_text, wait_for_control,
    wait_for_fork_wire_count, write_fork_agent, ForkChildAnchor,
};
use super::prompt_message_actor_tests::{
    install_scripted_agent_env, read_requests, temp_runtime_home,
};
use super::startup_facts::choose_session_startup_strategy;
use crate::app::test_support;
use crate::domains::sessions::model::parse_action_capabilities;
use crate::domains::sessions::runtime::{EnsureLiveSessionError, ForkSessionError};
use crate::domains::workspaces::checkpoints::{CheckpointOrigin, CheckpointRecord};
use crate::persistence::Db;

// --- (a) Two-boundary dispatch proof ---------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn targeted_fork_persists_provider_anchor_and_exact_checkpoint_after_child_persistence() {
    // Each targeted fork dispatches through the real Claude process-local
    // branch: the derived inclusive anchor rides the outbound `session/fork`
    // `_meta.anyharness.upToMessageId` AND is recorded verbatim as the fork
    // operation's provider anchor. The first boundary also has an exact Lane H
    // checkpoint; both provenance dimensions must coexist on the completed
    // operation. The second boundary pins the explicit no-checkpoint case.
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-dispatch");
    let script = write_fork_agent(&runtime_home, "strict");
    let _guards = install_scripted_agent_env(&script);
    std::fs::write(script.control_dir.join("fork-race"), b"").expect("arm fork race");
    let state = build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let parent_id = seed_parent(&state, Some(r#"{"fork":true,"targetedFork":true}"#));
    seed_three_turn_transcript(&state, &parent_id);
    let checkpoint_id = "checkpoint-at-turn-1";
    state
        .workspace_checkpoint_service
        .store_for_tests()
        .insert_checkpoint(&CheckpointRecord {
            id: checkpoint_id.to_string(),
            workspace_id: "workspace-fork".to_string(),
            origin: CheckpointOrigin::TurnStart,
            session_id: Some(parent_id.clone()),
            turn_id: Some("turn-1".to_string()),
            prompt_id: None,
            fork_operation_id: None,
            revert_operation_id: None,
            head_sha: "0".repeat(40),
            work_tree_oid: "1".repeat(40),
            index_tree_oid: "2".repeat(40),
            work_tree_anchored: false,
            index_tree_anchored: false,
            notices_json: None,
            created_at: "2026-08-17T00:00:00Z".to_string(),
            updated_at: "2026-08-17T00:00:00Z".to_string(),
            expired_at: None,
        })
        .expect("seed exact targeted-fork checkpoint");

    let first = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            None,
            None,
        )
        .await
        .expect("first targeted fork dispatches");
    std::fs::write(script.control_dir.join("release-delayed-parent"), b"")
        .expect("release delayed parent only after child readiness");
    wait_for_fork_wire_count(&script.request_log, 1).await;
    assert_eq!(fork_wire_anchors(&script.request_log), ["msg-0"]);
    assert_child_anchor_provenance(&state, &first.session.id, "msg-0", Some(checkpoint_id));
    assert_child_event_prefix(&state, &parent_id, &first.session.id, 3);
    wait_for_child_notification_text(&state, &first.session.id, "CHILD-BEFORE-FORK-RESULT").await;
    wait_for_child_notification_text(&state, &first.session.id, "CHILD-AFTER-FORK-RESULT").await;
    wait_for_control(&script.control_dir.join("delayed-parent-emitted")).await;
    let barrier_path = script.control_dir.join("delayed-parent-barrier-response");
    wait_for_control(&barrier_path).await;
    let barrier: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&barrier_path).expect("read delayed-parent barrier"))
            .expect("parse delayed-parent barrier");
    assert_eq!(barrier["id"], "delayed-parent-barrier");
    assert_eq!(
        barrier["result"],
        serde_json::json!({"outcome": {"outcome": "cancelled"}})
    );
    assert!(barrier.get("error").is_none());
    let first_notifications = state
        .session_service
        .store()
        .list_raw_notifications(&first.session.id)
        .expect("list first child notifications");
    assert!(first_notifications.iter().all(|notification| {
        !notification
            .payload_json
            .contains("PARENT-REPLAY-MUST-NOT-PERSIST")
            && !notification
                .payload_json
                .contains("DELAYED-PARENT-MUST-NOT-PERSIST")
    }));
    let first_events = state
        .session_service
        .list_session_event_records(&first.session.id, None, None, None, None, false)
        .expect("list first child events")
        .expect("first child exists");
    assert!(
        first_events
            .iter()
            .all(|event| event.event_type != "interaction_requested"),
        "delayed parent requests must allocate no child interaction"
    );
    std::fs::remove_file(script.control_dir.join("fork-race"))
        .expect("disarm race fixture before second fork");

    let second = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-2", "item-2")),
            None,
            None,
        )
        .await
        .expect("second targeted fork dispatches");
    wait_for_fork_wire_count(&script.request_log, 2).await;
    assert_eq!(fork_wire_anchors(&script.request_log), ["msg-0", "msg-1"]);
    assert_child_anchor_provenance(&state, &second.session.id, "msg-1", None);
    assert_child_event_prefix(&state, &parent_id, &second.session.id, 6);
    assert_process_local_fork_wire_contract(&script.request_log);

    let children = fork_children(&state, &parent_id);
    assert_eq!(children.len(), 2);
    assert!(children.contains(&first.session.id));
    assert!(children.contains(&second.session.id));

    close_all(
        &state,
        &[
            "fork-parent",
            first.session.id.as_str(),
            second.session.id.as_str(),
        ],
    )
    .await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

fn assert_child_event_prefix(
    state: &crate::app::AppState,
    parent_id: &str,
    child_id: &str,
    terminal_seq: i64,
) {
    let events = |session_id| {
        state
            .session_service
            .list_session_event_records(session_id, None, None, None, None, false)
            .expect("list session event records")
            .expect("session exists")
            .into_iter()
            .map(|event| {
                (
                    event.seq,
                    event.timestamp,
                    event.event_type,
                    event.turn_id,
                    event.item_id,
                    event.payload_json,
                )
            })
            .collect::<Vec<_>>()
    };
    let parent_events = events(parent_id);
    let expected = parent_events
        .iter()
        .filter(|event| event.0 <= terminal_seq)
        .cloned()
        .collect::<Vec<_>>();
    let child_events = events(child_id);
    let actual_prefix = child_events
        .iter()
        .filter(|event| event.0 <= terminal_seq)
        .cloned()
        .collect::<Vec<_>>();
    assert_eq!(actual_prefix, expected);
    for excluded in parent_events
        .into_iter()
        .filter(|event| event.0 > terminal_seq)
    {
        assert!(
            !child_events.contains(&excluded),
            "child snapshot copied a parent event past the resolved prefix"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn parent_permission_during_hydration_is_cancelled_without_native_fork_or_interaction() {
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-parent-permission");
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
        .expect("start parent before arming child hydration fault");
    std::fs::write(script.control_dir.join("parent-permission-on-load"), b"")
        .expect("arm parent permission");

    state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("parent-permission-child".to_string()),
            None,
        )
        .await
        .expect_err("parent interaction must fail child startup");

    let receipt_path = script.control_dir.join("parent-permission-response");
    wait_for_control(&receipt_path).await;
    let receipt: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&receipt_path).expect("read cancellation receipt"))
            .expect("parse cancellation receipt");
    assert_eq!(receipt["id"], "parent-permission");
    assert_eq!(
        receipt["result"],
        serde_json::json!({"outcome": {"outcome": "cancelled"}})
    );
    assert!(receipt.get("error").is_none());
    assert!(
        !read_requests(&script.request_log)
            .iter()
            .any(|request| request["method"] == "session/fork"),
        "hydration interaction must fail before the native fork seam"
    );
    let operation = state
        .session_service
        .store()
        .find_fork_operation_by_key("parent-permission-child")
        .expect("query fork operation")
        .expect("fork operation exists");
    assert_eq!(
        operation.phase,
        crate::domains::sessions::model::ForkOperationPhase::Failed
    );
    let child = state
        .session_service
        .get_session("parent-permission-child")
        .expect("get child")
        .expect("child exists");
    assert_eq!(child.status, "errored");
    let child_events = state
        .session_service
        .list_session_event_records("parent-permission-child", None, None, None, None, false)
        .expect("list child events")
        .expect("child exists");
    assert!(
        child_events
            .iter()
            .all(|event| event.event_type != "interaction_requested"),
        "quarantined parent requests must allocate no product interaction"
    );
    assert_process_local_fork_wire_contract(&script.request_log);

    close_all(&state, &[parent_id.as_str()]).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

// --- (b)(i) Restart-drift pin: pre-pin-bump surface ------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn legacy_probe_shape_refuses_targeted_fork_end_to_end() {
    // Today's shipped reality through the REAL probe: the live start persists
    // the legacy Claude shape (fork true, targeted_fork false), so a targeted
    // fork fails closed with FORK_UNSUPPORTED and issues no native fork.
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-legacy");
    let script = write_fork_agent(&runtime_home, "legacy");
    let _guards = install_scripted_agent_env(&script);
    let state = build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let parent_id = seed_parent(&state, None);

    state
        .session_runtime
        .ensure_live_session(&parent_id, None)
        .await
        .expect("parent starts live and the probe persists capabilities");
    let persisted = state
        .session_service
        .get_session(&parent_id)
        .expect("get parent")
        .expect("parent row");
    let caps = parse_action_capabilities(persisted.action_capabilities_json.as_deref());
    assert!(caps.fork, "legacy shape still advertises tip fork");
    assert!(
        !caps.targeted_fork,
        "legacy shape is not targeted-fork ready"
    );

    let error = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            None,
            None,
        )
        .await
        .expect_err("legacy shape refuses a targeted fork");
    assert!(matches!(error, ForkSessionError::Unsupported(_)));
    assert!(fork_children(&state, &parent_id).is_empty());
    assert!(
        !read_requests(&script.request_log)
            .iter()
            .any(|request| request["method"] == "session/fork"),
        "no native fork may be issued for a refused targeted request"
    );

    close_all(&state, &[parent_id.as_str()]).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn live_targeted_readiness_wins_when_capability_persistence_fails() {
    // A pre-start durable `targetedFork=true` is only a cache. Even when the
    // live legacy handshake cannot persist false, actor-owned truth must reject
    // before inserting an operation/child or sending an anchored session/fork.
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-stale-capability");
    let script = write_fork_agent(&runtime_home, "legacy");
    let _guards = install_scripted_agent_env(&script);
    let state = build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let parent_id = seed_parent(&state, Some(r#"{"fork":true,"targetedFork":true}"#));
    seed_three_turn_transcript(&state, &parent_id);
    state
        .db
        .with_conn(|conn| {
            conn.execute_batch(
                "CREATE TRIGGER reject_capability_refresh
                 BEFORE UPDATE OF action_capabilities_json ON sessions
                 WHEN OLD.id = 'fork-parent'
                 BEGIN
                   SELECT RAISE(FAIL, 'capability refresh blocked');
                 END;",
            )
        })
        .expect("install capability refresh failure");

    let error = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("stale-capability-child".to_string()),
            None,
        )
        .await
        .expect_err("current actor truth rejects stale durable readiness");
    assert!(matches!(error, ForkSessionError::Unsupported(_)));

    let persisted = state
        .session_service
        .get_session(&parent_id)
        .expect("get parent")
        .expect("parent row");
    assert!(
        parse_action_capabilities(persisted.action_capabilities_json.as_deref()).targeted_fork,
        "the injected write failure must leave the durable negative control stale"
    );
    assert!(fork_children(&state, &parent_id).is_empty());
    assert!(state
        .session_service
        .store()
        .find_fork_operation_by_key("stale-capability-child")
        .expect("query fork operation")
        .is_none());
    assert!(
        !read_requests(&script.request_log)
            .iter()
            .any(|request| request["method"] == "session/fork"),
        "revoked targeted readiness must issue no native fork"
    );

    close_all(&state, &[parent_id.as_str()]).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

// --- (b)(ii) Restart-drift pin: cold-restart refusal -----------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cold_restart_refuses_process_local_fork_children_without_r1_proof() {
    // A zero-turn process-local fork child must refuse a cold launch and issue
    // no native session call, regardless of whether its recorded anchor is
    // intact. R1 owns the future exact-prefix recovery proof.
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-restart");
    let script = write_fork_agent(&runtime_home, "strict");
    let _guards = install_scripted_agent_env(&script);

    let state_a = build_fork_runtime_state(
        &runtime_home,
        Db::open(&runtime_home).expect("file db"),
        true,
    );
    seed_parent(&state_a, Some(r#"{"fork":true,"targetedFork":true}"#));
    seed_fork_child(&state_a, "corrupt-child", ForkChildAnchor::Missing);
    seed_fork_child(&state_a, "good-child", ForkChildAnchor::MessageId("msg-1"));
    drop(state_a);

    // Cold restart over the same on-disk sqlite: no cached live handle, no
    // re-seed (the workspace row already exists in the durable db).
    let state_b = build_fork_runtime_state(
        &runtime_home,
        Db::open(&runtime_home).expect("reopen db"),
        false,
    );

    let error = state_b
        .session_runtime
        .ensure_live_session("corrupt-child", None)
        .await
        .expect_err("missing recorded anchor must refuse launch");
    match error {
        EnsureLiveSessionError::Internal(error) => assert!(
            error.to_string().contains("exact-prefix recovery proof"),
            "unexpected refusal detail: {error}"
        ),
        other => panic!("expected an Internal launch refusal, got {other:?}"),
    }
    assert!(
        !read_requests(&script.request_log).iter().any(|request| {
            matches!(
                request["method"].as_str(),
                Some("session/new") | Some("session/fork")
            )
        }),
        "the refused child must not issue any native session call"
    );

    // Negative control: an intact anchor still does not authorize redispatch.
    let good = state_b
        .session_service
        .get_session("good-child")
        .expect("get good child")
        .expect("good child row");
    let error = choose_session_startup_strategy(&good, state_b.session_service.store())
        .expect_err("recorded anchor must not authorize cold redispatch");
    assert!(error.to_string().contains("exact-prefix recovery proof"));

    drop(state_b);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

// --- (c) Double-fork fault injection ---------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_double_fork_on_the_same_key_never_duplicates_the_child() {
    // With the first fork held in-flight inside the child actor's native
    // `session/fork`, a second fork on the SAME idempotency key + payload is
    // reconciled by the phase machine to the SAME child — exactly one operation
    // row, exactly one child, no second native fork.
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-double");
    let script = write_fork_agent(&runtime_home, "strict");
    let _guards = install_scripted_agent_env(&script);
    std::fs::write(script.control_dir.join("hold-fork"), b"").expect("arm fork hold");
    let state = Arc::new(build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    ));
    let parent_id = seed_parent(&state, Some(r#"{"fork":true}"#));

    let state_first = state.clone();
    let parent_first = parent_id.clone();
    let first = tokio::spawn(async move {
        state_first
            .session_runtime
            .fork_session(
                &parent_first,
                None,
                Some("shared-fork-child".to_string()),
                None,
            )
            .await
    });

    // The child row + operation are persisted before the held native fork.
    wait_for_control(&script.control_dir.join("fork-hold-seen")).await;

    let second = state
        .session_runtime
        .fork_session(
            &parent_id,
            None,
            Some("shared-fork-child".to_string()),
            None,
        )
        .await;
    match second {
        Ok(outcome) => assert_eq!(outcome.session.id, "shared-fork-child"),
        Err(ForkSessionError::NativeOutcomeUnknown) => {}
        other => panic!("racing same-key fork produced an unexpected outcome: {other:?}"),
    }
    assert_eq!(fork_children(&state, &parent_id).len(), 1);
    assert!(state
        .session_service
        .store()
        .find_fork_operation_by_key("shared-fork-child")
        .expect("query fork operation")
        .is_some());

    // Release the hold; the first fork completes cleanly and stays singular.
    std::fs::write(script.control_dir.join("release-fork"), b"").expect("release fork hold");
    let first_outcome = first.await.expect("join first fork task");
    assert!(
        first_outcome.is_ok(),
        "the held first fork completes: {first_outcome:?}"
    );
    assert_eq!(fork_children(&state, &parent_id).len(), 1);

    close_all(&state, &["fork-parent", "shared-fork-child"]).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}
