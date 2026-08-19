//! Forks ADR rung 3 targeted-fork wire-in: end-to-end scenario tests driving a
//! real scripted stdio ACP agent subprocess over real file-/memory-backed
//! sqlite (fixtures in `fork_scenario_fixtures`). These pin the runtime-side
//! dispatch seams the pure gate/anchor tests (`fork_anchor_gate_tests`,
//! `launch_policy`, `startup_facts`) only cover in isolation: the derived
//! provider anchor actually rides the outbound `session/fork` wire request,
//! the shipped legacy probe still fails closed for a targeted request, a cold
//! restart refuses a targeted child whose recorded anchor is missing, and a
//! concurrent same-key double fork never duplicates the child.

use std::sync::Arc;

use super::fork_scenario_fixtures_tests::{
    assert_child_anchor_provenance, before_user_message, build_fork_runtime_state, close_all,
    fork_children, fork_wire_anchors, seed_fork_child, seed_parent, seed_three_turn_transcript,
    wait_for_control, wait_for_fork_wire_count, write_fork_agent, ForkChildAnchor,
};
use super::prompt_message_actor_tests::{
    install_scripted_agent_env, read_requests, temp_runtime_home,
};
use super::startup_facts::choose_session_startup_strategy;
use crate::app::test_support;
use crate::domains::sessions::model::parse_action_capabilities;
use crate::domains::sessions::runtime::fork_anchor::ProviderForkAnchor;
use crate::domains::sessions::runtime::{EnsureLiveSessionError, ForkSessionError};
use crate::live::sessions::SessionStartupStrategy;
use crate::persistence::Db;

// --- (a) Two-boundary dispatch proof ---------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn targeted_fork_dispatches_the_derived_message_id_anchor_for_each_boundary() {
    // Each targeted fork dispatches through the real Claude process-local
    // branch: the derived inclusive anchor rides the outbound `session/fork`
    // `_meta.anyharness.upToMessageId` AND is recorded verbatim as the fork
    // operation's provider anchor. Never anchor-less, never a tip downgrade.
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-dispatch");
    let script = write_fork_agent(&runtime_home, "strict");
    let _guards = install_scripted_agent_env(&script);
    let state = build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let parent_id = seed_parent(&state, Some(r#"{"fork":true,"targetedFork":true}"#));
    seed_three_turn_transcript(&state, &parent_id);

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
    wait_for_fork_wire_count(&script.request_log, 1).await;
    assert_eq!(fork_wire_anchors(&script.request_log), ["msg-0"]);
    assert_child_anchor_provenance(&state, &first.session.id, "msg-0");

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
    assert_child_anchor_provenance(&state, &second.session.id, "msg-1");

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

// --- (b)(ii) Restart-drift pin: cold-restart refusal -----------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cold_restart_refuses_targeted_fork_child_missing_recorded_anchor() {
    // A targeted fork child whose recorded provider anchor is missing must
    // refuse to launch on a cold restart (never silently re-fork at the parent
    // tip) and issue no native session call. The negative-control twin, with
    // the anchor recorded, resolves to ForkFromNative carrying that anchor.
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
            error.to_string().contains("recorded provider anchor"),
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

    // Negative control: with the anchor recorded, the restart strategy carries
    // it (proved directly via the pure resolver rather than a full launch).
    let good = state_b
        .session_service
        .get_session("good-child")
        .expect("get good child")
        .expect("good child row");
    let strategy = choose_session_startup_strategy(&good, state_b.session_service.store())
        .expect("recorded anchor yields a startup strategy");
    assert_eq!(
        strategy,
        SessionStartupStrategy::ForkFromNative {
            parent_native_session_id: "native-parent".to_string(),
            provider_anchor: Some(ProviderForkAnchor::UpToMessageId("msg-1".to_string())),
        }
    );

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
