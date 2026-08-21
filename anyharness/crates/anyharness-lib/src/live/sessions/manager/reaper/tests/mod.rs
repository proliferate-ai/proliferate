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
use crate::live::sessions::actor::command::{
    ConditionalUnloadOutcome, SessionCommand, UnloadRetainedReason,
};
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

/// Register a live handle whose scripted consumer answers the conditional
/// unload the way an idle actor does: `Unloading`, then it leaves the
/// manager's live map exactly as `retire_generation_after_actor_finish` would
/// once the actor loop exits. `unload_session_if_still_idle` therefore runs
/// for real, including its wait for the registered handle to disappear.
///
/// What this scripted consumer CANNOT prove is anything about the actor's own
/// exit sequence: no `finalize_exit`, no `persist_exit_disposition`, no
/// process kill. Those are proven against the real loop in
/// `actor/tests/idle_reap.rs`.
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
            match command {
                SessionCommand::UnloadIfIdle { respond_to } => {
                    let _ = respond_to.send(ConditionalUnloadOutcome::Unloading);
                    retiring_manager.remove_session(&retiring_session_id).await;
                    return;
                }
                SessionCommand::Unload { respond_to } => {
                    let _ = respond_to.send(Ok(()));
                    retiring_manager.remove_session(&retiring_session_id).await;
                    return;
                }
                _ => {}
            }
        }
    });
    handle
}

/// A live handle whose scripted actor REFUSES the conditional unload, the way
/// a real actor does when work arrived after the sweep's observation.
async fn register_busy_refusing_session(
    manager: &LiveSessionManager,
    session_id: &str,
) -> Arc<LiveSessionHandle> {
    let (command_tx, mut command_rx) = mpsc::channel(8);
    let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(8);
    let handle = Arc::new(LiveSessionHandle::new_for_test(
        session_id,
        command_tx,
        event_tx,
        Some(format!("native-{session_id}")),
        SessionExecutionPhase::Idle,
    ));
    manager
        .live_sessions
        .write()
        .await
        .insert(session_id.to_string(), handle.clone());
    tokio::spawn(async move {
        while let Some(command) = command_rx.recv().await {
            if let SessionCommand::UnloadIfIdle { respond_to } = command {
                let _ = respond_to.send(ConditionalUnloadOutcome::Retained(
                    UnloadRetainedReason::MailboxNotEmpty,
                ));
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

fn seed_link(db: &Db, link_id: &str, relation: &str, parent: &str, child: &str) {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO session_links (
                id, relation, parent_session_id, child_session_id, workspace_relation, created_at
             ) VALUES (?1, ?2, ?3, ?4, 'same_workspace', '2026-08-21T00:00:01Z')",
            rusqlite::params![link_id, relation, parent, child],
        )?;
        Ok(())
    })
    .expect("seed link");
}

fn link_completion(link_id: &str) -> LinkCompletionRecord {
    LinkCompletionRecord {
        completion_id: format!("completion-{link_id}"),
        session_link_id: link_id.to_string(),
        child_turn_id: "turn-child-1".to_string(),
        child_last_event_seq: 7,
        outcome: SessionTurnOutcome::Completed,
        parent_event_seq: None,
        parent_prompt_seq: None,
        created_at: "2026-08-21T00:10:00Z".to_string(),
        updated_at: "2026-08-21T00:10:00Z".to_string(),
    }
}

/// Two sweeps: one that starts the clock, one past the threshold.
async fn sweep_twice(reaper: &mut IdleSessionReaper) -> Vec<String> {
    let start = Instant::now();
    reaper.sweep(start).await;
    reaper.sweep(start + THRESHOLD).await.reaped
}

mod policy;
mod quiescence;
mod relaunch;
mod wake;
