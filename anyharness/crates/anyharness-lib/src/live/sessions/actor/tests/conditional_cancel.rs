//! Deterministic proof of the active-turn conditional-cancel arm
//! (`SessionCommand::CancelTurnIfActive`) in `turn/active.rs`.
//!
//! These tests drive the REAL actor turn loop (`SessionActor::run_turn`) against
//! an in-process fake ACP agent over `tokio::io::duplex`. The client side is
//! wired exactly as production (`driver/connection.rs::establish_connection`);
//! the actor struct is constructed directly with a dummy child process instead
//! of running the full spawn/startup handshake, which is the narrowest honest
//! entry into the arm under test. No generalized harness — only what these two
//! assertions need.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol as acp;
use anyharness_contract::v1::{
    SessionActionCapabilities, SessionEventEnvelope, SessionExecutionPhase,
};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use crate::app::test_support::{actor_capabilities_for_store, seed_workspace_with_repo_root};
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::actor::command::{
    ConditionalCancelOutcome, PromptAcceptance, SessionCommand,
};
use crate::live::sessions::actor::config::types::PersistedSessionConfigState;
use crate::live::sessions::actor::notifications::replay_filter::ResumeReplayFilter;
use crate::live::sessions::actor::state::{SessionActor, SessionStartupState};
use crate::live::sessions::actor::turn::active::ActivePromptRequest;
use crate::live::sessions::background_work::{
    BackgroundWorkOptions, BackgroundWorkRegistry, BackgroundWorkUpdate,
};
use crate::live::sessions::driver::inbound::InboundDoor;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::{SessionHooks, SystemPromptAppends};
use crate::live::sessions::rendezvous::broker::InteractionRendezvous;
use crate::live::sessions::sink::SessionEventSink;
use crate::persistence::Db;

type DuplexRead = tokio::io::ReadHalf<tokio::io::DuplexStream>;
type DuplexWrite = tokio::io::WriteHalf<tokio::io::DuplexStream>;

const SESSION_ID: &str = "session-1";
const WORKSPACE_ID: &str = "workspace-1";
const NATIVE_SESSION_ID: &str = "native-1";

/// Everything a test needs to drive one turn and observe the fake agent.
struct Harness {
    actor: SessionActor,
    command_rx: mpsc::Receiver<SessionCommand>,
    notification_rx: mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
    background_work_rx: mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    handle: Arc<LiveSessionHandle>,
    /// Deferred `session/prompt` responders the fake agent has received; holding
    /// one keeps the turn's prompt future pending until the test completes it.
    prompt_responder_rx: mpsc::UnboundedReceiver<acp::Responder<acp::schema::PromptResponse>>,
    /// Every `session/cancel` the fake agent received.
    cancel_rx: mpsc::UnboundedReceiver<acp::schema::CancelNotification>,
    /// Kept alive so the in-memory database outlives the actor.
    _store: SessionStore,
}

fn test_session_record() -> SessionRecord {
    SessionRecord {
        id: SESSION_ID.to_string(),
        workspace_id: WORKSPACE_ID.to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: Some(NATIVE_SESSION_ID.to_string()),
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".to_string(),
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

/// Build a real `SessionActor` wired to a fake ACP agent over a duplex pipe.
/// Must be called inside a `LocalSet` (the ACP connection tasks are spawned via
/// `spawn_local`, exactly as production does).
async fn spawn_harness() -> Harness {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace_with_repo_root(&db, WORKSPACE_ID, "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    let session = test_session_record();
    store.insert(&session).expect("insert session");
    let caps = actor_capabilities_for_store(&store);

    let (command_tx, command_rx) = mpsc::channel::<SessionCommand>(32);
    let (event_tx, _event_rx) = broadcast::channel::<SessionEventEnvelope>(64);
    let handle = Arc::new(LiveSessionHandle::new(
        SESSION_ID,
        command_tx,
        event_tx.clone(),
        Some(NATIVE_SESSION_ID.to_string()),
        SessionExecutionPhase::Idle,
    ));

    let event_sink = Arc::new(Mutex::new(SessionEventSink::new(
        SESSION_ID.to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        event_tx.clone(),
        caps.events.clone(),
    )));

    let (background_tx, background_work_rx) = mpsc::unbounded_channel::<BackgroundWorkUpdate>();
    let background_work_registry = BackgroundWorkRegistry::new(
        SESSION_ID.to_string(),
        "claude".to_string(),
        caps.background.clone(),
        background_tx,
        BackgroundWorkOptions::default(),
    );

    let interaction_broker = Arc::new(InteractionRendezvous::new());
    let (notification_tx, notification_rx) =
        mpsc::unbounded_channel::<acp::schema::SessionNotification>();

    // In-process transport: one duplex pipe, split into the client (actor) and
    // agent (fake) byte streams.
    let (client_io, agent_io) = tokio::io::duplex(64 * 1024);
    let (client_read, client_write) = tokio::io::split(client_io);
    let (agent_read, agent_write) = tokio::io::split(agent_io);

    // Client side — the actor's `conn`, mirroring establish_connection.
    let inbound = Arc::new(InboundDoor::new(
        SESSION_ID.to_string(),
        notification_tx,
        interaction_broker.clone(),
        event_sink.clone(),
        handle.clone(),
        WORKSPACE_ID.to_string(),
        "claude".to_string(),
        None,
    ));
    let (conn, acp_shutdown) = establish_test_client(inbound, client_write, client_read).await;

    // Fake agent side.
    let (prompt_responder_tx, prompt_responder_rx) =
        mpsc::unbounded_channel::<acp::Responder<acp::schema::PromptResponse>>();
    let (cancel_tx, cancel_rx) = mpsc::unbounded_channel::<acp::schema::CancelNotification>();
    spawn_fake_agent(agent_write, agent_read, prompt_responder_tx, cancel_tx);

    // A live child process guard the actor owns and drops on exit; never spoken
    // to (the ACP transport is the duplex above).
    let child = tokio::process::Command::new("sleep")
        .arg("300")
        .kill_on_drop(true)
        .spawn()
        .expect("spawn dummy child process");

    let actor = SessionActor {
        session_id: SESSION_ID.to_string(),
        workspace_id: WORKSPACE_ID.to_string(),
        agent_kind: "claude".to_string(),
        workspace_path: PathBuf::from("/tmp/workspace"),
        mcp_servers: Vec::new(),
        prompts: SystemPromptAppends::default(),
        event_sink,
        background_work_registry,
        resume_replay_filter: ResumeReplayFilter::disabled(),
        persisted_config_state: PersistedSessionConfigState::from_session(&session),
        startup_state: SessionStartupState {
            current_mode_id: None,
            legacy_mode_state: None,
            config_options: Vec::new(),
            current_model_id: None,
            available_models: Vec::new(),
            prompt_capabilities: Default::default(),
        },
        native_session_id: NATIVE_SESSION_ID.to_string(),
        action_capabilities: SessionActionCapabilities::default(),
        supports_native_close: false,
        conn,
        caps,
        hooks: SessionHooks::default(),
        interaction_broker,
        handle: handle.clone(),
        _acp_shutdown: acp_shutdown,
        child,
    };

    Harness {
        actor,
        command_rx,
        notification_rx,
        background_work_rx,
        handle,
        prompt_responder_rx,
        cancel_rx,
        _store: store,
    }
}

/// Establish the client (actor-side) ACP connection over the duplex halves,
/// registering the same four inbound handlers as
/// `driver/connection.rs::establish_connection`.
async fn establish_test_client(
    client: Arc<InboundDoor>,
    write: DuplexWrite,
    read: DuplexRead,
) -> (acp::ConnectionTo<acp::Agent>, oneshot::Sender<()>) {
    let (cx_tx, cx_rx) = oneshot::channel::<acp::ConnectionTo<acp::Agent>>();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let transport = acp::ByteStreams::new(write.compat_write(), read.compat());

    let client_for_notif = client.clone();
    let client_for_perm = client.clone();
    let client_for_ext = client.clone();
    let client_for_elicitation = client.clone();

    let connect_future = acp::Client
        .builder()
        .on_receive_notification(
            async move |notif: acp::schema::SessionNotification, _cx| {
                client_for_notif.handle_session_notification(notif).await
            },
            acp::on_receive_notification!(),
        )
        .on_receive_request(
            async move |req: acp::schema::RequestPermissionRequest,
                        responder: acp::Responder<acp::schema::RequestPermissionResponse>,
                        _cx| {
                let result = client_for_perm.handle_request_permission(req).await;
                responder.respond_with_result(result)
            },
            acp::on_receive_request!(),
        )
        .on_receive_request(
            async move |req: acp::schema::CreateElicitationRequest,
                        responder: acp::Responder<acp::schema::CreateElicitationResponse>,
                        _cx| {
                let result = client_for_elicitation.standard_mcp_elicitation(req).await;
                responder.respond_with_result(result)
            },
            acp::on_receive_request!(),
        )
        .on_receive_request(
            async move |req: acp::AgentRequest,
                        responder: acp::Responder<serde_json::Value>,
                        _cx| {
                match req {
                    acp::AgentRequest::ExtMethodRequest(ext_req) => {
                        let result = client_for_ext.handle_ext_request(ext_req).await;
                        match result {
                            Ok(ext_resp) => {
                                let json = serde_json::to_value(&ext_resp.0).map_err(|e| {
                                    acp::Error::internal_error().data(e.to_string())
                                })?;
                                responder.respond(json)
                            }
                            Err(e) => Err(e),
                        }
                    }
                    _ => Err(acp::Error::method_not_found()),
                }
            },
            acp::on_receive_request!(),
        )
        .connect_with(
            transport,
            move |cx: acp::ConnectionTo<acp::Agent>| async move {
                let _ = cx_tx.send(cx);
                let _ = shutdown_rx.await;
                Ok(())
            },
        );

    tokio::task::spawn_local(async move {
        let _ = connect_future.await;
    });

    let conn = cx_rx.await.expect("client ACP connection established");
    (conn, shutdown_tx)
}

/// A minimal fake ACP agent: it defers every `session/prompt` (handing the
/// responder to the test so the turn stays in-flight) and records every
/// `session/cancel` it receives. Returning immediately from the prompt handler
/// keeps the dispatch loop free to deliver the cancel notification.
fn spawn_fake_agent(
    write: DuplexWrite,
    read: DuplexRead,
    prompt_responder_tx: mpsc::UnboundedSender<acp::Responder<acp::schema::PromptResponse>>,
    cancel_tx: mpsc::UnboundedSender<acp::schema::CancelNotification>,
) {
    let transport = acp::ByteStreams::new(write.compat_write(), read.compat());
    let connect_future = acp::Agent
        .builder()
        .name("conditional-cancel-fake-agent")
        .on_receive_request(
            async move |_req: acp::schema::PromptRequest,
                        responder: acp::Responder<acp::schema::PromptResponse>,
                        _cx| {
                // Defer: do NOT respond here. Hand the responder to the test and
                // return so the agent stays free to service session/cancel.
                let _ = prompt_responder_tx.send(responder);
                Ok(())
            },
            acp::on_receive_request!(),
        )
        .on_receive_notification(
            async move |notif: acp::schema::CancelNotification, _cx| {
                let _ = cancel_tx.send(notif);
                Ok(())
            },
            acp::on_receive_notification!(),
        )
        .connect_with(
            transport,
            move |_cx: acp::ConnectionTo<acp::Client>| async move {
                std::future::pending::<()>().await;
                Ok(())
            },
        );

    tokio::task::spawn_local(async move {
        let _ = connect_future.await;
    });
}

/// Start the real turn loop on a local task, returning the minted active turn id
/// (via the real `PromptAcceptance::Started`), the held prompt responder, and
/// the join handle for the turn's eventual disposition.
async fn start_turn(
    harness: Harness,
) -> (
    Arc<LiveSessionHandle>,
    String,
    acp::Responder<acp::schema::PromptResponse>,
    mpsc::UnboundedReceiver<acp::schema::CancelNotification>,
    tokio::task::JoinHandle<
        Option<crate::live::sessions::actor::shutdown::types::ActorExitDisposition>,
    >,
) {
    let Harness {
        mut actor,
        mut command_rx,
        mut notification_rx,
        mut background_work_rx,
        handle,
        mut prompt_responder_rx,
        cancel_rx,
        _store,
    } = harness;

    let (accept_tx, accept_rx) = oneshot::channel();
    let request = ActivePromptRequest {
        payload: PromptPayload::text("drive the turn".to_string()),
        prompt_id: None,
        from_queue_seq: None,
        respond_to: accept_tx,
    };

    let actor_task = tokio::task::spawn_local(async move {
        // `_store` must outlive the actor's use of the in-memory database.
        let _store = _store;
        actor
            .run_turn(
                request,
                &mut command_rx,
                &mut notification_rx,
                &mut background_work_rx,
            )
            .await
    });

    // The real prompt path minted and reported the active turn id.
    let acceptance = accept_rx
        .await
        .expect("turn accepted")
        .expect("prompt started");
    let turn_id = match acceptance {
        PromptAcceptance::Started { turn_id } => turn_id,
        other => panic!("expected Started acceptance, got {other:?}"),
    };

    // The prompt reached the fake agent; hold its response open so the turn
    // stays active while we exercise the cancel command.
    let responder = tokio::time::timeout(Duration::from_secs(5), prompt_responder_rx.recv())
        .await
        .expect("prompt delivered to fake agent")
        .expect("prompt responder present");

    (handle, turn_id, responder, cancel_rx, actor_task)
}

#[tokio::test]
async fn active_turn_exact_match_forwards_acp_cancel() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let harness = spawn_harness().await;
            let (handle, turn_id, responder, mut cancel_rx, actor_task) = start_turn(harness).await;

            // Exact-turn conditional cancel via the REAL handle path.
            let outcome = handle.cancel_turn_if_active(turn_id.clone()).await;
            assert_eq!(
                outcome,
                Some(ConditionalCancelOutcome::Requested),
                "exact active-turn match must reply Requested"
            );

            // The ACP cancel was forwarded to the agent for this native session.
            let cancel = tokio::time::timeout(Duration::from_secs(5), cancel_rx.recv())
                .await
                .expect("cancel notification delivered to agent")
                .expect("cancel notification present");
            assert_eq!(
                &*cancel.session_id.0, NATIVE_SESSION_ID,
                "cancel must target the actor's native session"
            );

            // Let the turn settle (agent confirms cancellation) so the loop exits.
            responder
                .respond(acp::schema::PromptResponse::new(
                    acp::schema::StopReason::Cancelled,
                ))
                .expect("respond to held prompt");
            let disposition = tokio::time::timeout(Duration::from_secs(5), actor_task)
                .await
                .expect("actor turn task finished")
                .expect("actor turn task joined");
            assert!(
                disposition.is_none(),
                "a cancelled turn must not request an actor exit"
            );
        })
        .await;
}

#[tokio::test]
async fn active_turn_stale_id_never_cancels_foreign_work() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let harness = spawn_harness().await;
            let (handle, turn_id, responder, mut cancel_rx, actor_task) = start_turn(harness).await;

            // The active turn ("turn B") is a freshly minted id, never "turn-A".
            assert_ne!(turn_id, "turn-A");

            // A stale/foreign id must be rejected without touching the agent.
            let outcome = handle.cancel_turn_if_active("turn-A".to_string()).await;
            assert_eq!(
                outcome,
                Some(ConditionalCancelOutcome::NotActive),
                "a stale turn id must reply NotActive"
            );

            // Bounded negative wait: no CancelNotification may reach the agent.
            let leaked = tokio::time::timeout(Duration::from_millis(200), cancel_rx.recv()).await;
            assert!(
                leaked.is_err(),
                "a stale conditional cancel must NEVER forward ACP cancellation"
            );

            // The foreign work survived: finish it normally and prove the turn
            // completes (not an exit, not a cancellation).
            responder
                .respond(acp::schema::PromptResponse::new(
                    acp::schema::StopReason::EndTurn,
                ))
                .expect("respond to held prompt");
            let disposition = tokio::time::timeout(Duration::from_secs(5), actor_task)
                .await
                .expect("actor turn task finished")
                .expect("actor turn task joined");
            assert!(
                disposition.is_none(),
                "an untouched turn must finish without requesting an actor exit"
            );
        })
        .await;
}
