use std::sync::Arc;
use std::time::Duration;

use anyharness_contract::v1::{
    PendingInteractionPayloadSummary, PendingInteractionSource, PendingInteractionSummary,
    SessionEventEnvelope, SessionExecutionPhase,
};
use tokio::sync::{broadcast, mpsc};
use tokio::time::Instant;

use super::{IdleReapPolicy, IdleReapVerdict, IdleSessionReaper, DEFAULT_IDLE_REAP_THRESHOLD};
use crate::app::test_support;
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::links::completions::{LinkCompletionRecord, LinkCompletionStore};
use crate::domains::sessions::model::{
    SessionBackgroundWorkRecord, SessionBackgroundWorkState, SessionBackgroundWorkTrackerKind,
    SessionRecord,
};
use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::actor::command::SessionCommand;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::manager::LiveSessionManager;
use crate::persistence::Db;

const THRESHOLD: Duration = Duration::from_secs(120);

fn session_record(id: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: "workspace-1".to_string(),
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
        status: "idle".to_string(),
        created_at: "2026-08-21T00:00:00Z".to_string(),
        updated_at: "2026-08-21T00:00:00Z".to_string(),
        last_prompt_at: Some("2026-08-21T00:00:30Z".to_string()),
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

fn seeded_store(session_ids: &[&str]) -> SessionStore {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db);
    for id in session_ids {
        store.insert(&session_record(id)).expect("insert session");
    }
    store
}

/// Register a live handle whose scripted consumer behaves like a real actor on
/// `Unload`: it acknowledges the command, then leaves the manager's live map
/// exactly as `retire_generation_after_actor_finish` would once the actor loop
/// exits. `unload_session_nonterminal` therefore runs for real, including its
/// wait for the registered handle to disappear.
async fn register_live_session(
    manager: &LiveSessionManager,
    session_id: &str,
    phase: SessionExecutionPhase,
) -> Arc<LiveSessionHandle> {
    let (command_tx, mut command_rx) = mpsc::channel(8);
    let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(8);
    let handle = Arc::new(LiveSessionHandle::new_for_test(
        session_id,
        command_tx,
        event_tx,
        Some(format!("native-{session_id}")),
        phase,
    ));
    manager
        .live_sessions
        .write()
        .await
        .insert(session_id.to_string(), handle.clone());

    let retiring_manager = manager.clone();
    let retiring_session_id = session_id.to_string();
    tokio::spawn(async move {
        while let Some(command) = command_rx.recv().await {
            if let SessionCommand::Unload { respond_to } = command {
                let _ = respond_to.send(Ok(()));
                retiring_manager.remove_session(&retiring_session_id).await;
                return;
            }
        }
    });
    handle
}

async fn is_live(manager: &LiveSessionManager, session_id: &str) -> bool {
    manager.live_sessions.read().await.contains_key(session_id)
}

fn pending_background_work(session_id: &str) -> SessionBackgroundWorkRecord {
    SessionBackgroundWorkRecord {
        session_id: session_id.to_string(),
        tool_call_id: "tool-call-1".to_string(),
        turn_id: "turn-1".to_string(),
        tracker_kind: SessionBackgroundWorkTrackerKind::ClaudeAsyncAgent,
        source_agent_kind: "claude".to_string(),
        agent_id: Some("agent-1".to_string()),
        output_file: "/tmp/out.txt".to_string(),
        state: SessionBackgroundWorkState::Pending,
        created_at: "2026-08-21T00:00:00Z".to_string(),
        updated_at: "2026-08-21T00:00:00Z".to_string(),
        launched_at: "2026-08-21T00:00:00Z".to_string(),
        last_activity_at: "2026-08-21T00:00:00Z".to_string(),
        completed_at: None,
    }
}

/// Two sweeps: one that starts the clock, one past the threshold.
async fn sweep_twice(reaper: &mut IdleSessionReaper) -> Vec<String> {
    let start = Instant::now();
    reaper.sweep(start).await;
    reaper.sweep(start + THRESHOLD).await.reaped
}

#[tokio::test]
async fn continuously_idle_session_is_reaped_after_the_threshold() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    let start = Instant::now();

    assert_eq!(reaper.sweep(start).await.reaped, Vec::<String>::new());
    assert!(is_live(&manager, "session-1").await);

    assert_eq!(
        reaper
            .sweep(start + THRESHOLD - Duration::from_secs(1))
            .await
            .reaped,
        Vec::<String>::new(),
        "a session short of the threshold must survive"
    );
    assert!(is_live(&manager, "session-1").await);

    assert_eq!(
        reaper.sweep(start + THRESHOLD).await.reaped,
        vec!["session-1".to_string()]
    );
    assert!(!is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn awaiting_interaction_session_is_never_reaped() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    let handle = register_live_session(
        &manager,
        "session-1",
        SessionExecutionPhase::AwaitingInteraction,
    )
    .await;
    handle
        .add_pending_interaction(PendingInteractionSummary {
            request_id: "request-1".to_string(),
            kind: anyharness_contract::v1::InteractionKind::Permission,
            title: "Run a tool".to_string(),
            description: None,
            source: PendingInteractionSource {
                tool_call_id: None,
                tool_kind: None,
                tool_status: None,
                linked_plan_id: None,
            },
            payload: PendingInteractionPayloadSummary::Permission {
                options: vec![],
                context: None,
            },
        })
        .await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    let start = Instant::now();
    reaper.sweep(start).await;
    let outcome = reaper.sweep(start + THRESHOLD * 10).await;

    assert_eq!(outcome.reaped, Vec::<String>::new());
    assert_eq!(outcome.awaiting_interaction_held, 1);
    assert!(is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn session_with_a_queued_prompt_is_not_reaped() {
    let store = seeded_store(&["session-1"]);
    store
        .insert_pending_prompt_payload(
            "session-1",
            &PromptPayload::text("queued work".to_string()),
            None,
        )
        .expect("insert pending prompt");
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(sweep_twice(&mut reaper).await, Vec::<String>::new());
    assert!(is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn session_with_live_background_work_is_not_reaped_until_it_completes() {
    let store = seeded_store(&["session-1"]);
    let record = pending_background_work("session-1");
    store
        .upsert_or_refresh_pending_background_work(&record)
        .expect("insert background work");
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(sweep_twice(&mut reaper).await, Vec::<String>::new());
    assert!(is_live(&manager, "session-1").await);

    store
        .mark_background_work_terminal(
            "session-1",
            &record.tool_call_id,
            SessionBackgroundWorkState::Completed,
            "2026-08-21T00:05:00Z",
        )
        .expect("mark background work terminal");

    assert_eq!(
        sweep_twice(&mut reaper).await,
        vec!["session-1".to_string()],
        "the same session becomes reapable once its tracker is terminal"
    );
    assert!(!is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn a_busy_handle_is_not_reaped() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    let handle = register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;
    handle.set_busy(true);

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(sweep_twice(&mut reaper).await, Vec::<String>::new());
    assert!(is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn activity_between_sweeps_restarts_the_idle_clock() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    let handle = register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    let start = Instant::now();
    reaper.sweep(start).await;

    // A notification arrived while the session sat idle. The handle bumps its
    // activity marker exactly as the actor's notification dispatch does.
    handle
        .mark_activity_at("2026-08-21T01:00:00Z".to_string())
        .await;

    assert_eq!(
        reaper.sweep(start + THRESHOLD).await.reaped,
        Vec::<String>::new(),
        "activity must restart the continuous-idleness clock"
    );
    assert!(is_live(&manager, "session-1").await);

    assert_eq!(
        reaper.sweep(start + THRESHOLD * 2).await.reaped,
        vec!["session-1".to_string()],
        "and the restarted clock must still run out"
    );
}

#[tokio::test]
async fn reaped_session_stays_resumable_with_its_native_session_id() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(
        sweep_twice(&mut reaper).await,
        vec!["session-1".to_string()]
    );

    // Exactly the durable shape the resume path consumes. With
    // `native_session_id` and `last_prompt_at` both present and the row still
    // non-terminal, `choose_session_startup_strategy` selects
    // `LoadNative(native_session_id)` (pinned by
    // `choose_startup_strategy_loads_claude_when_last_prompt_was_recorded` in
    // `domains/sessions/runtime/tests.rs`), so the next prompt lands back in
    // the same native conversation.
    let record = store
        .find_by_id("session-1")
        .expect("read session")
        .expect("session row survives reaping");
    assert_eq!(
        record.native_session_id.as_deref(),
        Some("native-session-1")
    );
    assert_eq!(record.status, "idle");
    assert_eq!(record.closed_at, None);
    assert_eq!(record.dismissed_at, None);
    assert_eq!(
        record.last_prompt_at.as_deref(),
        Some("2026-08-21T00:00:30Z")
    );
    assert!(!is_live(&manager, "session-1").await);
}

/// Mandatory acceptance test named by the delivery specification: reaping a
/// parent must not strand a mobility/cowork wake schedule. The schedule is a
/// durable row, the child's completion consumes it inside one store
/// transaction with no live parent involved, and the resulting wake prompt
/// lands in the parent's durable queue, which then holds the reaper off until
/// the completion-delivery worker cold-starts the parent to drain it.
#[tokio::test]
async fn a_pending_wake_schedule_survives_reaping_and_still_wakes_the_parent() {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    store.insert(&session_record("session-1")).expect("parent");
    store.insert(&session_record("child-1")).expect("child");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO session_links (
                id, relation, parent_session_id, child_session_id, workspace_relation, created_at
             ) VALUES ('link-1', 'subagent', 'session-1', 'child-1', 'same_workspace', ?1)",
            ["2026-08-21T00:00:01Z"],
        )?;
        Ok(())
    })
    .expect("seed link");

    let completions = LinkCompletionStore::new(db.clone());
    assert!(completions
        .schedule_wake("link-1")
        .expect("schedule the parent wake"));

    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(
        sweep_twice(&mut reaper).await,
        vec!["session-1".to_string()],
        "a parent holding only a wake schedule is still idle and still reapable"
    );
    assert!(!is_live(&manager, "session-1").await);

    assert_eq!(
        completions
            .list_wake_schedules(&["link-1".to_string()])
            .expect("list wake schedules")
            .len(),
        1,
        "reaping must not consume or drop the wake schedule"
    );

    // The child finishes while the parent is reaped.
    let insert = completions
        .insert_completion_and_consume_schedule(
            &LinkCompletionRecord {
                completion_id: "completion-1".to_string(),
                session_link_id: "link-1".to_string(),
                child_turn_id: "turn-child-1".to_string(),
                child_last_event_seq: 7,
                outcome: SessionTurnOutcome::Completed,
                parent_event_seq: None,
                parent_prompt_seq: None,
                created_at: "2026-08-21T00:10:00Z".to_string(),
                updated_at: "2026-08-21T00:10:00Z".to_string(),
            },
            "session-1",
            &PromptPayload::text("your delegate finished".to_string()),
        )
        .expect("record the child completion")
        .expect("completion inserted");

    let wake_prompt = insert
        .wake_prompt
        .expect("a reaped parent must still be handed its wake prompt");
    assert_eq!(wake_prompt.session_id, "session-1");
    assert_eq!(
        store
            .list_pending_prompts("session-1")
            .expect("list pending prompts")
            .len(),
        1,
        "the wake is durable in the parent's queue, ready for cold-start drain"
    );

    // The queue is now non-empty, so the reaper holds off the freshly
    // cold-started parent instead of racing the wake back out of existence.
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;
    assert_eq!(sweep_twice(&mut reaper).await, Vec::<String>::new());
    assert!(is_live(&manager, "session-1").await);
}

#[tokio::test]
async fn a_session_that_never_settles_is_not_reaped() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Running).await;

    let mut reaper = IdleSessionReaper::new(manager.clone(), THRESHOLD);
    assert_eq!(sweep_twice(&mut reaper).await, Vec::<String>::new());
    assert!(is_live(&manager, "session-1").await);
}

#[test]
fn the_default_policy_matches_the_founder_ruling_and_zero_disables_it() {
    assert_eq!(DEFAULT_IDLE_REAP_THRESHOLD, Duration::from_secs(120));
    assert_eq!(
        IdleReapPolicy::with_threshold(DEFAULT_IDLE_REAP_THRESHOLD).threshold(),
        Some(Duration::from_secs(120))
    );
    assert_eq!(
        IdleReapPolicy::with_threshold(Duration::ZERO),
        IdleReapPolicy::disabled()
    );
    assert_eq!(IdleReapPolicy::disabled().threshold(), None);
    assert_eq!(IdleReapPolicy::disabled().sweep_interval(), None);
    assert_eq!(
        IdleReapPolicy::with_threshold(Duration::from_secs(120)).sweep_interval(),
        Some(Duration::from_secs(15)),
        "the cadence is capped so the observed idle duration converges on the threshold"
    );
    assert_eq!(
        IdleReapPolicy::with_threshold(Duration::from_secs(20)).sweep_interval(),
        Some(Duration::from_secs(5))
    );
}

/// The spawned loop, end to end: its own cadence, its own clock, a real reap.
#[tokio::test]
async fn the_spawned_reaper_retires_an_idle_session_on_its_own_cadence() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    manager.spawn_idle_reaper(IdleReapPolicy::with_threshold(Duration::from_millis(20)));

    for _ in 0..100 {
        if !is_live(&manager, "session-1").await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the spawned reaper never retired a continuously idle session");
}

/// The `0` disable value from `ANYHARNESS_IDLE_SESSION_REAP_SECONDS`: the
/// sweep task must not start at all, even for a session that is idle forever.
#[tokio::test]
async fn a_zero_threshold_disables_the_reaper_entirely() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    manager.spawn_idle_reaper(IdleReapPolicy::with_threshold(Duration::ZERO));
    tokio::time::sleep(Duration::from_millis(200)).await;

    assert!(
        is_live(&manager, "session-1").await,
        "a disabled reaper must never retire anything"
    );
}

#[tokio::test]
async fn the_verdict_names_the_exact_condition_that_blocked_a_reap() {
    let store = seeded_store(&["session-1"]);
    let manager = LiveSessionManager::new(test_support::actor_capabilities_for_store(&store));
    let handle = register_live_session(&manager, "session-1", SessionExecutionPhase::Idle).await;

    let snapshot = handle.execution_snapshot().await;
    assert_eq!(
        manager.idle_reap_verdict("session-1", &handle, &snapshot),
        IdleReapVerdict::Quiescent
    );

    handle.set_busy(true);
    assert_eq!(
        manager.idle_reap_verdict("session-1", &handle, &snapshot),
        IdleReapVerdict::Busy
    );
    handle.set_busy(false);

    store
        .upsert_or_refresh_pending_background_work(&pending_background_work("session-1"))
        .expect("insert background work");
    assert_eq!(
        manager.idle_reap_verdict("session-1", &handle, &snapshot),
        IdleReapVerdict::BackgroundWork
    );
}
