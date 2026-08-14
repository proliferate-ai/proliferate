//! `stop_all_for_workspace` coverage that does not need a real spawned
//! process: the row-write policy (which statuses move to `idle`, which
//! don't) and the zero-count no-op path. Real process-group death for the
//! agent spawn this primitive kills is proven at the mechanism level
//! (`process_kill_tests.rs`) and at the actor's own exit-sequence level
//! (`live/sessions/actor/tests/workspace_stop.rs`, which spawns a real
//! process through the exact `stop_and_await` -> `run()` path this method
//! calls) - this file is the domain-level census aggregation and row policy
//! only, driven through a scripted live handle so it stays fast and
//! deterministic.

use crate::app::test_support;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::ScriptedSessionSpec;
use crate::persistence::Db;

fn session_record(id: &str, workspace_id: &str, status: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: Some(format!("native-{id}")),
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: status.to_string(),
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy:
            crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

async fn test_state(runtime_home_label: &str) -> crate::app::AppState {
    let runtime_home = std::env::temp_dir().join(format!(
        "anyharness-stop-all-for-workspace-{runtime_home_label}-{}",
        uuid::Uuid::new_v4()
    ));
    crate::app::AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state")
}

#[tokio::test(flavor = "current_thread")]
async fn stop_all_for_workspace_returns_zero_kills_for_a_workspace_with_no_sessions() {
    let state = test_state("empty").await;
    test_support::seed_workspace_with_repo_root(&state.db, "workspace-empty", "local", "/tmp/ws");

    let kills = state
        .session_runtime
        .stop_all_for_workspace("workspace-empty")
        .await
        .expect("stop_all_for_workspace must not error against an empty workspace");

    assert_eq!(kills.total, 0);
    assert_eq!(kills.git, 0);
}

#[tokio::test(flavor = "current_thread")]
async fn stop_all_for_workspace_moves_a_running_session_to_idle_and_aggregates_the_census() {
    let state = test_state("running").await;
    test_support::seed_workspace_with_repo_root(&state.db, "workspace-1", "local", "/tmp/ws");
    let store = SessionStore::new(state.db.clone());
    store
        .insert(&session_record("session-running", "workspace-1", "running"))
        .expect("insert running session");

    // A scripted live handle stands in for the real agent process: this
    // test is about the row-write policy and census aggregation, not
    // process death (proven elsewhere - see the module doc). `Stop` answers
    // with a nonzero census so the aggregation path is exercised too.
    state
        .session_runtime
        .acp_manager_for_test()
        .insert_scripted_session_for_test(
            "session-running",
            ScriptedSessionSpec {
                prompt_turn_id: "turn-unused".to_string(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;

    let kills = state
        .session_runtime
        .stop_all_for_workspace("workspace-1")
        .await
        .expect("stop_all_for_workspace");

    assert_eq!(kills.total, 3, "the scripted census must be aggregated");
    assert_eq!(kills.git, 1);

    let updated = store
        .find_by_id("session-running")
        .expect("load session")
        .expect("session exists");
    assert_eq!(
        updated.status, "idle",
        "a running session must move to its stopped (idle), resumable state"
    );

    assert!(
        state
            .session_runtime
            .acp_manager_for_test()
            .get_handle("session-running")
            .await
            .is_none(),
        "the live handle must be removed once the session is stopped"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn stop_all_for_workspace_leaves_a_closed_or_errored_session_untouched() {
    let state = test_state("terminal").await;
    test_support::seed_workspace_with_repo_root(&state.db, "workspace-2", "local", "/tmp/ws");
    let store = SessionStore::new(state.db.clone());
    store
        .insert(&session_record("session-closed", "workspace-2", "closed"))
        .expect("insert closed session");
    store
        .insert(&session_record("session-errored", "workspace-2", "errored"))
        .expect("insert errored session");

    // BOTH terminal rows get a live scripted handle. Without one the loop
    // takes the `get_handle -> None` short-circuit and never reaches the
    // status guard at all, which makes the assertions below vacuous - delete
    // the guard and an unhandled version of this test still passes. Note the
    // rows carry `closed_at = NULL` (see `session_record`), so
    // `update_status`'s own `closed_at IS NULL` clause would happily rewrite
    // them: the status guard is the only thing standing in the way.
    for session_id in ["session-closed", "session-errored"] {
        state
            .session_runtime
            .acp_manager_for_test()
            .insert_scripted_session_for_test(
                session_id,
                ScriptedSessionSpec {
                    prompt_turn_id: "turn-unused".to_string(),
                    hold_config_replies: false,
                    hold_cancel_replies: false,
                },
            )
            .await;
    }

    let kills = state
        .session_runtime
        .stop_all_for_workspace("workspace-2")
        .await
        .expect("stop_all_for_workspace");

    // The stop itself still runs against both handles (a terminal ROW is not
    // a reason to leave a live process alive) - it is only the row write that
    // is withheld.
    assert_eq!(
        kills.total, 6,
        "both scripted handles must still be stopped and their census aggregated"
    );
    assert_eq!(kills.git, 2);

    let closed = store
        .find_by_id("session-closed")
        .expect("load")
        .expect("exists");
    let errored = store
        .find_by_id("session-errored")
        .expect("load")
        .expect("exists");
    assert_eq!(
        closed.status, "closed",
        "a closed session must never be rewritten to idle"
    );
    assert_eq!(
        errored.status, "errored",
        "an errored session must never be rewritten to idle"
    );
}

/// The sessions-plane half of the fan-out contract: `stop_all_for_workspace`
/// must drive its per-session stops CONCURRENTLY. Each real stop carries its
/// own TERM → 5s grace → KILL escalation, so a sequential walk pays one grace
/// window per live session and a two-session workspace already exceeds R4's
/// 8s `QUIESCE_DEADLINE`. Here each scripted handle holds its `Stop` reply for
/// `STOP_DELAY`, standing in for that escalation: three sessions must cost one
/// delay, not three.
#[tokio::test(flavor = "current_thread")]
async fn stop_all_for_workspace_drives_its_sessions_concurrently() {
    const STOP_DELAY: std::time::Duration = std::time::Duration::from_millis(1_500);

    let state = test_state("concurrent").await;
    test_support::seed_workspace_with_repo_root(&state.db, "workspace-3", "local", "/tmp/ws");
    let store = SessionStore::new(state.db.clone());
    for session_id in ["session-a", "session-b", "session-c"] {
        store
            .insert(&session_record(session_id, "workspace-3", "running"))
            .expect("insert running session");
        state
            .session_runtime
            .acp_manager_for_test()
            .insert_slow_stop_session_for_test(session_id, STOP_DELAY)
            .await;
    }

    let started = tokio::time::Instant::now();
    let kills = state
        .session_runtime
        .stop_all_for_workspace("workspace-3")
        .await
        .expect("stop_all_for_workspace");
    let elapsed = started.elapsed();

    assert_eq!(kills.total, 3, "every session must still be stopped");
    assert!(
        elapsed < STOP_DELAY * 2,
        "three sessions must share ONE stop window, not stack three of them \
         (sequential would cost ~{:?}, this took {elapsed:?})",
        STOP_DELAY * 3
    );
    assert!(
        elapsed >= STOP_DELAY,
        "the stops must really have been awaited, not skipped: {elapsed:?}"
    );

    for session_id in ["session-a", "session-b", "session-c"] {
        let updated = store
            .find_by_id(session_id)
            .expect("load session")
            .expect("session exists");
        assert_eq!(updated.status, "idle");
    }
}
