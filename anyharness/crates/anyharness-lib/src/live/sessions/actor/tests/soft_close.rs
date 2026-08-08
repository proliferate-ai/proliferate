//! Deterministic proof that a requested close fences turn STARTS.
//!
//! A soft close stamps the ownership row and lets the in-flight step finish;
//! the turn-finish hook then closes the tree from a spawned task. Nothing in
//! that story stops the actor's idle loop from picking the next durable prompt
//! off its queue the instant turn N ends — and the close, landing milliseconds
//! later, would then kill turn N+1 mid-step. That is exactly the interruption
//! the soft close promises never happens (`specs/anyharness/sessions.md`).
//!
//! These tests drive the REAL actor idle loop (`SessionActor::run`) against an
//! in-process fake ACP agent over `tokio::io::duplex`, with real `session_links`
//! and `session_pending_prompts` rows behind it. Same construction technique,
//! and the same justification, as `conditional_cancel.rs`: the actor struct is
//! built directly rather than through the spawn/startup handshake, which is the
//! narrowest honest entry into the loop under test.

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
use crate::domains::sessions::links::model::{SessionLinkRelation, SessionLinkWorkspaceRelation};
use crate::domains::sessions::links::service::{CreateSessionLinkInput, SessionLinkService};
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::model::SessionRecord;
use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::actor::command::SessionCommand;
use crate::live::sessions::actor::config::types::PersistedSessionConfigState;
use crate::live::sessions::actor::notifications::replay_filter::ResumeReplayFilter;
use crate::live::sessions::actor::state::{SessionActor, SessionStartupState};
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
const PARENT_SESSION_ID: &str = "session-parent";
const WORKSPACE_ID: &str = "workspace-1";
const NATIVE_SESSION_ID: &str = "native-1";

struct Harness {
    actor: SessionActor,
    command_tx: mpsc::Sender<SessionCommand>,
    command_rx: mpsc::Receiver<SessionCommand>,
    notification_rx: mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
    background_work_rx: mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    /// Every `session/prompt` the fake agent received, responder held open so
    /// the test decides when a turn ends.
    prompt_responder_rx: mpsc::UnboundedReceiver<acp::Responder<acp::schema::PromptResponse>>,
    store: SessionStore,
    links: SessionLinkService,
    link_id: String,
    _handle: Arc<LiveSessionHandle>,
}

fn session_record(id: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
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

/// A real `SessionActor` wired to a fake ACP agent, with the soft-close fence
/// reading the same in-memory database the test writes ownership rows to.
async fn spawn_harness() -> Harness {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace_with_repo_root(&db, WORKSPACE_ID, "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    let session = session_record(SESSION_ID);
    store.insert(&session).expect("insert session");
    store
        .insert(&session_record(PARENT_SESSION_ID))
        .expect("insert parent session");

    let links = SessionLinkService::new(SessionLinkStore::new(db.clone()), store.clone());
    let link_id = links
        .create_link(CreateSessionLinkInput {
            relation: SessionLinkRelation::Subagent,
            parent_session_id: PARENT_SESSION_ID.to_string(),
            child_session_id: SESSION_ID.to_string(),
            workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
            label: Some("Schema audit".to_string()),
            created_by_turn_id: None,
            created_by_tool_call_id: None,
        })
        .expect("link the agent to its owner")
        .id;

    let mut caps = actor_capabilities_for_store(&store);
    // Production wiring (`app/sessions.rs`): the fence reads the link store.
    caps.close_requests = Some(Arc::new(SessionLinkStore::new(db)));

    let (command_tx, command_rx) = mpsc::channel::<SessionCommand>(32);
    let (event_tx, _event_rx) = broadcast::channel::<SessionEventEnvelope>(64);
    let handle = Arc::new(LiveSessionHandle::new(
        SESSION_ID,
        command_tx.clone(),
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

    let (client_io, agent_io) = tokio::io::duplex(64 * 1024);
    let (client_read, client_write) = tokio::io::split(client_io);
    let (agent_read, agent_write) = tokio::io::split(agent_io);

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

    let (prompt_responder_tx, prompt_responder_rx) =
        mpsc::unbounded_channel::<acp::Responder<acp::schema::PromptResponse>>();
    spawn_fake_agent(agent_write, agent_read, prompt_responder_tx);

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
        command_tx,
        command_rx,
        notification_rx,
        background_work_rx,
        prompt_responder_rx,
        store,
        links,
        link_id,
        _handle: handle,
    }
}

/// Client (actor-side) ACP connection over the duplex halves, registering the
/// same inbound handlers as `driver/connection.rs::establish_connection`.
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

/// A minimal fake agent: it defers every `session/prompt`, handing the responder
/// to the test, so a turn stays in flight until the test ends it.
fn spawn_fake_agent(
    write: DuplexWrite,
    read: DuplexRead,
    prompt_responder_tx: mpsc::UnboundedSender<acp::Responder<acp::schema::PromptResponse>>,
) {
    let transport = acp::ByteStreams::new(write.compat_write(), read.compat());
    let connect_future = acp::Agent
        .builder()
        .name("soft-close-fake-agent")
        .on_receive_request(
            async move |_req: acp::schema::PromptRequest,
                        responder: acp::Responder<acp::schema::PromptResponse>,
                        _cx| {
                let _ = prompt_responder_tx.send(responder);
                Ok(())
            },
            acp::on_receive_request!(),
        )
        .on_receive_notification(
            async move |_notif: acp::schema::CancelNotification, _cx| Ok(()),
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

/// Turn N runs, a close is requested mid-turn, a prompt is queued behind it.
/// When turn N finishes, the queued prompt must NOT become turn N+1: the close
/// is about to land, and a turn started here is a step killed in the middle.
#[tokio::test]
async fn a_requested_close_stops_the_queue_from_starting_the_next_turn() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let Harness {
                actor,
                command_tx,
                command_rx,
                notification_rx,
                background_work_rx,
                mut prompt_responder_rx,
                store,
                links,
                link_id,
                _handle,
            } = spawn_harness().await;

            let store_for_assertions = store.clone();
            let actor_task = tokio::task::spawn_local(async move {
                actor
                    .run(command_rx, notification_rx, background_work_rx)
                    .await
            });

            // Turn N: the ordinary prompt path, through the real idle loop.
            let (accept_tx, accept_rx) = oneshot::channel();
            command_tx
                .send(SessionCommand::Prompt {
                    payload: PromptPayload::text("turn N".to_string()),
                    prompt_id: None,
                    from_queue_seq: None,
                    respond_to: accept_tx,
                })
                .await
                .expect("send turn N");
            let _ = accept_rx.await.expect("turn N accepted");
            let turn_n = tokio::time::timeout(Duration::from_secs(5), prompt_responder_rx.recv())
                .await
                .expect("turn N reached the agent")
                .expect("responder present");

            // Mid-turn: the owner closes this agent. `close_agent` stamps the
            // still-open ownership row and returns "end requested" — that stamp
            // IS the durable close request.
            links
                .record_close_attribution(&link_id, PARENT_SESSION_ID, Some("superseded"))
                .expect("stamp the close request");
            // ...and somebody had already queued a prompt behind the turn.
            let queued = store
                .insert_pending_prompt_payload(
                    SESSION_ID,
                    &PromptPayload::text("turn N+1".to_string()),
                    None,
                )
                .expect("queue a prompt behind turn N");

            // Turn N finishes normally. Nothing here interrupts it.
            turn_n
                .respond(acp::schema::PromptResponse::new(
                    acp::schema::StopReason::EndTurn,
                ))
                .expect("finish turn N");

            // The race: the idle loop is now free to drain. It must not.
            let started = tokio::time::timeout(
                Duration::from_millis(750),
                prompt_responder_rx.recv(),
            )
            .await;
            assert!(
                started.is_err(),
                "a queued prompt must NOT start a turn while a close is pending — the close \
                 would kill it mid-step"
            );

            // The prompt is not lost, it is simply not started: the durable row
            // is untouched, and its transcript stays readable after the close.
            let still_queued = store_for_assertions
                .list_pending_prompts(SESSION_ID)
                .expect("pending prompts");
            assert_eq!(still_queued.len(), 1);
            assert_eq!(still_queued[0].seq, queued.seq);

            // The request is still armed for the deferred close to consume.
            assert!(links
                .find_pending_close_request(SESSION_ID)
                .expect("pending close lookup")
                .is_some());

            drop(command_tx);
            let _ = tokio::time::timeout(Duration::from_secs(5), actor_task).await;
        })
        .await;
}

/// Negative control for the test above: with no close requested, the very same
/// queued prompt DOES become the next turn. Without this, the assertion above
/// would also pass if the queue drain were simply broken.
#[tokio::test]
async fn without_a_close_request_the_same_queued_prompt_becomes_the_next_turn() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let Harness {
                actor,
                command_tx,
                command_rx,
                notification_rx,
                background_work_rx,
                mut prompt_responder_rx,
                store,
                links,
                link_id: _link_id,
                _handle,
            } = spawn_harness().await;

            let actor_task = tokio::task::spawn_local(async move {
                actor
                    .run(command_rx, notification_rx, background_work_rx)
                    .await
            });

            let (accept_tx, accept_rx) = oneshot::channel();
            command_tx
                .send(SessionCommand::Prompt {
                    payload: PromptPayload::text("turn N".to_string()),
                    prompt_id: None,
                    from_queue_seq: None,
                    respond_to: accept_tx,
                })
                .await
                .expect("send turn N");
            let _ = accept_rx.await.expect("turn N accepted");
            let turn_n = tokio::time::timeout(Duration::from_secs(5), prompt_responder_rx.recv())
                .await
                .expect("turn N reached the agent")
                .expect("responder present");

            store
                .insert_pending_prompt_payload(
                    SESSION_ID,
                    &PromptPayload::text("turn N+1".to_string()),
                    None,
                )
                .expect("queue a prompt behind turn N");
            assert!(links
                .find_pending_close_request(SESSION_ID)
                .expect("pending close lookup")
                .is_none());

            turn_n
                .respond(acp::schema::PromptResponse::new(
                    acp::schema::StopReason::EndTurn,
                ))
                .expect("finish turn N");

            let turn_n_plus_1 =
                tokio::time::timeout(Duration::from_secs(5), prompt_responder_rx.recv())
                    .await
                    .expect("the queued prompt starts the next turn")
                    .expect("responder present");
            turn_n_plus_1
                .respond(acp::schema::PromptResponse::new(
                    acp::schema::StopReason::EndTurn,
                ))
                .expect("finish turn N+1");

            drop(command_tx);
            let _ = tokio::time::timeout(Duration::from_secs(5), actor_task).await;
        })
        .await;
}
