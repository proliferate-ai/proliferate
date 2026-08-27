//! Real-process proof of R3's sessions-plane primitive: `stop_and_await` (the
//! `SessionCommand::Stop` path through `run()`'s exit sequence) must AWAIT
//! confirmed death of the agent's whole process GROUP - including a
//! `git`-named grandchild, per ruling R3-1 - not merely reply at
//! command-accept time the way `Dismiss` does.
//!
//! This drives the REAL idle loop (`SessionActor::run`) against a real,
//! doubly-real dummy "agent" process: a `/bin/sh` script spawned with
//! `process_group(0)`, exactly as `spawn_agent_process` spawns the real
//! agent CLI (`live/sessions/driver/process.rs`). The ACP side is an
//! in-process duplex exactly like `conditional_cancel.rs`'s harness: the fake
//! peer defers every `session/prompt` and records (but never honors) every
//! `session/cancel`, which is all the idle-loop cases need and exactly the
//! cancel-ignoring agent the ACTIVE-turn stop bound exists for.

use std::path::PathBuf;
use std::process::Stdio;
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
use crate::live::sessions::actor::command::{PromptAcceptance, SessionCommand};
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
use crate::process_kill::pid_is_alive;

pub(super) const SESSION_ID: &str = "session-1";
pub(super) const WORKSPACE_ID: &str = "workspace-1";
pub(super) const NATIVE_SESSION_ID: &str = "native-1";

pub(super) fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "anyharness-actor-workspace-stop-test-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

/// Compiles a trivial "sleep `<argv[1]>` seconds" binary to `dir/name` via
/// the system C compiler. Neither a shebang SCRIPT nor a `cp` of an Apple
/// system binary works here: a script's `proc_pidpath`/`/proc/<pid>/exe`
/// resolves to the interpreter, not the script; and macOS's code-signing/
/// library-validation enforcement SIGKILLs a platform binary (e.g.
/// `/bin/sleep`) the instant it is exec'd from a path other than its
/// originally-signed location (repro-verified: exit 137). A binary this
/// test compiles itself has neither problem.
pub(super) fn compile_sleep_binary_named(dir: &std::path::Path, name: &str) -> PathBuf {
    let source = dir.join(format!("{name}.c"));
    std::fs::write(
        &source,
        "#include <unistd.h>\n#include <stdlib.h>\n\
         int main(int argc, char **argv) {\n\
         \x20\x20\x20\x20unsigned secs = argc > 1 ? (unsigned)atoi(argv[1]) : 300;\n\
         \x20\x20\x20\x20sleep(secs);\n\
         \x20\x20\x20\x20return 0;\n\
         }\n",
    )
    .expect("write fake-executable source");
    let path = dir.join(name);
    let status = std::process::Command::new("cc")
        .arg("-O0")
        .arg("-o")
        .arg(&path)
        .arg(&source)
        .status()
        .expect("invoke cc to build the fake executable");
    assert!(status.success(), "cc failed to build the fake executable");
    path
}

pub(super) async fn wait_for_pidfile(path: &std::path::Path) -> i32 {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if let Ok(contents) = std::fs::read_to_string(path) {
            if let Ok(pid) = contents.trim().parse::<i32>() {
                return pid;
            }
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("pidfile {path:?} was not written within the wait budget");
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
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
        status: "running".to_string(),
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

type DuplexRead = tokio::io::ReadHalf<tokio::io::DuplexStream>;
type DuplexWrite = tokio::io::WriteHalf<tokio::io::DuplexStream>;

/// Establishes the client (actor-side) ACP connection exactly as
/// `driver/connection.rs::establish_connection` does, but the peer never
/// needs to answer anything for an idle-loop `Stop` test.
async fn establish_test_client(
    client: Arc<InboundDoor>,
    write: DuplexWrite,
    read: DuplexRead,
) -> (acp::ConnectionTo<acp::Agent>, oneshot::Sender<()>) {
    let (cx_tx, cx_rx) = oneshot::channel::<acp::ConnectionTo<acp::Agent>>();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let transport = acp::ByteStreams::new(write.compat_write(), read.compat());

    let client_for_notif = client.clone();
    let connect_future = acp::Client
        .builder()
        .on_receive_notification(
            async move |notif: acp::schema::SessionNotification, _cx| {
                client_for_notif.handle_session_notification(notif).await
            },
            acp::on_receive_notification!(),
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

/// The fake agent peer. It keeps the duplex's other end alive so the
/// client-side connection stays valid, DEFERS every `session/prompt` (handing
/// the responder to the test, exactly like `conditional_cancel.rs`'s harness,
/// so a turn can be held open indefinitely), and records every
/// `session/cancel` it receives without ever acting on it - the
/// cancel-ignoring agent the active-turn stop bound exists for. The idle-loop
/// tests never prompt, so for them it is still a peer that merely exists.
fn spawn_fake_agent_peer(
    write: DuplexWrite,
    read: DuplexRead,
    prompt_responder_tx: mpsc::UnboundedSender<acp::Responder<acp::schema::PromptResponse>>,
    cancel_tx: mpsc::UnboundedSender<acp::schema::CancelNotification>,
) {
    let transport = acp::ByteStreams::new(write.compat_write(), read.compat());
    let connect_future = acp::Agent
        .builder()
        .name("workspace-stop-fake-agent")
        .on_receive_request(
            async move |_req: acp::schema::PromptRequest,
                        responder: acp::Responder<acp::schema::PromptResponse>,
                        _cx| {
                // Defer: never respond. The turn stays in flight until the
                // actor abandons it.
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

/// Everything a stop test needs to drive the real actor against a real child
/// process and a fake ACP peer.
pub(super) struct RealChildActorHarness {
    pub(super) actor: SessionActor,
    pub(super) command_tx: mpsc::Sender<SessionCommand>,
    pub(super) command_rx: mpsc::Receiver<SessionCommand>,
    pub(super) handle: Arc<LiveSessionHandle>,
    /// Deferred `session/prompt` responders; one held keeps a turn pending.
    pub(super) prompt_responder_rx:
        mpsc::UnboundedReceiver<acp::Responder<acp::schema::PromptResponse>>,
    /// Every `session/cancel` the fake agent received (and ignored).
    pub(super) cancel_rx: mpsc::UnboundedReceiver<acp::schema::CancelNotification>,
    /// Kept alive so the in-memory database outlives the actor.
    pub(super) _store: SessionStore,
}

/// Builds a real `SessionActor` whose owned child is a REAL `/bin/sh`
/// process spawned with its own process group - the exact spawn shape
/// `spawn_agent_process` uses in production (R3-1). `agent_script` is the
/// dummy "agent"'s body (e.g. a TERM-ignoring script that backgrounds a
/// `git`-named grandchild).
pub(super) async fn spawn_actor_with_real_child(agent_script: &str) -> RealChildActorHarness {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace_with_repo_root(&db, WORKSPACE_ID, "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    let session = test_session_record();
    store.insert(&session).expect("insert session");
    let caps = actor_capabilities_for_store(&store);

    let (command_tx, command_rx) = mpsc::channel::<SessionCommand>(8);
    let (event_tx, _event_rx) = broadcast::channel::<SessionEventEnvelope>(16);
    let handle = Arc::new(LiveSessionHandle::new(
        SESSION_ID,
        command_tx.clone(),
        event_tx.clone(),
        Some(NATIVE_SESSION_ID.to_string()),
        SessionExecutionPhase::Running,
    ));

    let event_sink = Arc::new(Mutex::new(SessionEventSink::new(
        SESSION_ID.to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        event_tx.clone(),
        caps.events.clone(),
    )));

    let (background_tx, _background_work_rx_unused) =
        mpsc::unbounded_channel::<BackgroundWorkUpdate>();
    let background_work_registry = BackgroundWorkRegistry::new(
        SESSION_ID.to_string(),
        "claude".to_string(),
        caps.background.clone(),
        background_tx,
        BackgroundWorkOptions::default(),
    );

    let interaction_broker = Arc::new(InteractionRendezvous::new());
    let (notification_tx, _notification_rx_unused) =
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
    let (cancel_tx, cancel_rx) = mpsc::unbounded_channel::<acp::schema::CancelNotification>();
    spawn_fake_agent_peer(agent_write, agent_read, prompt_responder_tx, cancel_tx);

    let mut cmd = tokio::process::Command::new("/bin/sh");
    cmd.arg("-c")
        .arg(agent_script)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    let child = cmd.spawn().expect("spawn dummy real agent process");

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
        sidedoor: None,
        conn,
        caps,
        hooks: SessionHooks::default(),
        interaction_broker,
        handle: handle.clone(),
        _acp_shutdown: acp_shutdown,
        child,
        pending_stop_response: None,
    };

    RealChildActorHarness {
        actor,
        command_tx,
        command_rx,
        handle,
        prompt_responder_rx,
        cancel_rx,
        _store: store,
    }
}

#[tokio::test]
async fn stop_and_await_kills_the_real_process_group_including_a_git_grandchild() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let dir = temp_dir("stop-and-await");
            let git_bin = compile_sleep_binary_named(&dir, "git");
            let pidfile = dir.join("git.pid");
            // Mirrors C1's exact concern: an agent that ignores TERM and has
            // spawned a `git` grandchild. `process_group(0)` at spawn is what
            // makes both reachable by one group signal.
            let script = format!(
                "trap '' TERM; {} 300 & echo $! > {} ; wait",
                git_bin.display(),
                pidfile.display()
            );

            let RealChildActorHarness {
                actor,
                command_tx,
                command_rx,
                handle,
                _store,
                ..
            } = spawn_actor_with_real_child(&script).await;
            let agent_pid = actor.child.id().expect("agent pid") as i32;
            let (notification_tx, notification_rx) =
                mpsc::unbounded_channel::<acp::schema::SessionNotification>();
            let (background_tx, background_work_rx) =
                mpsc::unbounded_channel::<BackgroundWorkUpdate>();
            // Swap in fresh receivers wired to nothing but the loop itself -
            // the harness's own unused senders above are dropped, which is
            // fine: the idle loop only needs receivers that never yield
            // `None` prematurely, and closed-but-undropped senders here keep
            // them pending exactly like production's real notification/
            // background channels while idle.
            let _ = (notification_tx, background_tx);

            let git_pid = wait_for_pidfile(&pidfile).await;
            assert!(pid_is_alive(agent_pid), "dummy agent must be running");
            assert!(pid_is_alive(git_pid), "git grandchild must be running");

            let actor_task = tokio::task::spawn_local(async move {
                actor
                    .run(command_rx, notification_rx, background_work_rx)
                    .await
            });
            drop(command_tx.clone());

            let started = tokio::time::Instant::now();
            let census = handle
                .stop_and_await()
                .await
                .expect("stop_and_await must succeed");
            let elapsed = started.elapsed();

            assert!(
                census.0 >= 2,
                "the agent and its git grandchild must both be counted, got {census:?}"
            );
            assert_eq!(
                census.1, 1,
                "exactly the git-named process counts toward the git census"
            );
            assert!(
                !pid_is_alive(agent_pid),
                "stop_and_await must not return until the agent process is confirmed dead"
            );
            assert!(
                !pid_is_alive(git_pid),
                "the git grandchild must die with the group, not survive alongside a dead leader"
            );
            assert!(
                elapsed >= Duration::from_secs(5),
                "a TERM-ignoring agent must go through the real KILL escalation grace: {elapsed:?}"
            );

            actor_task
                .await
                .expect("actor task joined")
                .expect("actor run finished");
            let _ = std::fs::remove_dir_all(&dir);
        })
        .await;
}

/// The spec's native-resume soak, reduced to what tier 1 can prove without a
/// real agent CLI or a live model (`specs/engineering/testing/README.md`'s hard gate rule bars
/// both from the merge gate): that the KILL escalation `stop_and_await`
/// falls through to when TERM is ignored CAN truncate the dummy agent's
/// own append-only output file mid-record, leaving a torn trailing line -
/// exactly the risk the ADR names for a real agent's native JSONL
/// transcript. The dummy agent writes two complete JSON lines, then begins
/// a third and blocks before closing it, so the KILL that lands after the
/// 5s grace is guaranteed to land mid-record rather than racing a timing
/// window.
///
/// Recorded finding (manual probe, not part of this automated test): run
/// directly against the installed `claude` CLI (2.1.231) on 2026-08-13 by
/// starting a real headless session in an isolated scratch directory,
/// SIGKILLing it during an active turn, and inspecting its own transcript
/// file on disk. The kill did not tear the transcript's last line - the
/// CLI's native transcript writer appends one complete JSON record per
/// turn/tool-event rather than streaming raw bytes to disk, which narrows
/// (does not eliminate) the tear window to whatever internal buffering the
/// CLI does within a single record. That is real evidence the CLI's own
/// resume-time parser was not exercised against a torn line by this probe,
/// not evidence that it tolerates one - the parser boundary itself is
/// unverified. Per the spec's instruction, this is recorded rather than
/// silently widening `GRACE`: the 5s TERM grace in `process_kill.rs` is
/// UNCHANGED. Confirming the CLI's actual torn-line tolerance (and, if
/// intolerant, sizing a longer agent-plane grace) needs a live-model tier-3
/// pass and is flagged as a follow-up for the release train, not this rung.
#[tokio::test]
async fn stop_and_await_kill_escalation_can_leave_the_agents_own_output_torn_mid_record() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let dir = temp_dir("resume-soak");
            let transcript = dir.join("transcript.jsonl");
            // Trap FIRST: the test polls for the third record as readiness, so
            // TERM-immunity must precede it (trap-after left the 57ms gap that
            // flaked #2279); the open third record makes the tear file-state.
            let script = format!(
                "trap '' TERM; \
                 printf '{{\"type\":\"user\",\"line\":1}}\\n' >> {path}; \
                 printf '{{\"type\":\"assistant\",\"line\":2}}\\n' >> {path}; \
                 printf '{{\"type\":\"assistant\",\"line\":3,\"partial\":\"' >> {path}; \
                 sleep 300",
                path = transcript.display()
            );

            let RealChildActorHarness {
                actor,
                command_tx,
                command_rx,
                handle,
                _store,
                ..
            } = spawn_actor_with_real_child(&script).await;
            let agent_pid = actor.child.id().expect("agent pid") as i32;

            let (notification_tx, notification_rx) =
                mpsc::unbounded_channel::<acp::schema::SessionNotification>();
            let (background_tx, background_work_rx) =
                mpsc::unbounded_channel::<BackgroundWorkUpdate>();
            let _ = (notification_tx, background_tx);

            // Wait for the third, deliberately-unclosed record to land
            // before stopping - proves the kill lands mid-write rather than
            // before the agent has started its third append.
            let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
            loop {
                if std::fs::read_to_string(&transcript)
                    .map(|contents| contents.contains("\"partial\":\""))
                    .unwrap_or(false)
                {
                    break;
                }
                assert!(
                    tokio::time::Instant::now() < deadline,
                    "the dummy agent never wrote its third, unclosed record"
                );
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            assert!(pid_is_alive(agent_pid), "dummy agent must still be running");

            let actor_task = tokio::task::spawn_local(async move {
                actor
                    .run(command_rx, notification_rx, background_work_rx)
                    .await
            });
            drop(command_tx.clone());

            let started = tokio::time::Instant::now();
            let census = handle
                .stop_and_await()
                .await
                .expect("stop_and_await must succeed");
            let elapsed = started.elapsed();

            assert!(census.0 >= 1, "the agent must be counted: {census:?}");
            assert!(
                !pid_is_alive(agent_pid),
                "stop_and_await must not return until the agent is confirmed dead"
            );
            assert!(
                elapsed >= Duration::from_secs(5),
                "a TERM-ignoring agent must go through the real KILL escalation grace: {elapsed:?}"
            );

            let contents = std::fs::read_to_string(&transcript)
                .expect("dummy agent's output file must exist after the kill");
            // `.lines()` yields a final element for trailing content with no
            // terminating newline, so a well-formed two-record file and our
            // torn three-fragment file both split into three groups here -
            // the tear is proven by the trailing fragment failing to parse
            // and by the file's raw bytes never gaining a closing newline,
            // not by the fragment count.
            let lines: Vec<&str> = contents.lines().collect();
            assert_eq!(lines.len(), 3, "unexpected content: {contents:?}");
            assert!(
                serde_json::from_str::<serde_json::Value>(lines[0]).is_ok()
                    && serde_json::from_str::<serde_json::Value>(lines[1]).is_ok(),
                "the two complete records must remain well-formed: {contents:?}"
            );
            assert!(
                serde_json::from_str::<serde_json::Value>(lines[2]).is_err(),
                "the third record must be torn (unparseable) - the KILL landed mid-write: \
                 {contents:?}"
            );
            assert!(
                !contents.ends_with('\n'),
                "the KILL escalation must be able to leave a torn trailing record with no \
                 closing delimiter, reproducing the risk the ADR names for a real agent's \
                 native JSONL transcript: {contents:?}"
            );

            actor_task
                .await
                .expect("actor task joined")
                .expect("actor run finished");
            let _ = std::fs::remove_dir_all(&dir);
        })
        .await;
}

/// The ACTIVE-turn half of the stop contract, which shipped untested and
/// unbounded: an agent that ignores the ACP cancel must NOT be able to hold
/// `stop_and_await` open for the length of its turn.
///
/// The fake peer here defers the `session/prompt` forever and answers the
/// `session/cancel` with nothing at all - the cooperative-cancel failure mode
/// the ADR's own scenario ("a rebase started inside a running session
/// archives successfully") runs straight into. The turn's Stop arm must race
/// the cancel against `ACTIVE_TURN_STOP_BOUND`, abandon the turn when the
/// bound expires, and fall through to `run()`'s exit sequence, whose group
/// escalation reaps the agent regardless.
///
/// Negative control: remove the bound (the `stop_bound_at` arm in
/// `turn/active.rs`) and the loop waits on a prompt future that never
/// resolves - the outer 20s timeout below fails the test instead of the
/// suite hanging.
#[tokio::test]
async fn stop_and_await_bounds_an_active_turn_whose_agent_ignores_the_cancel() {
    /// Mirrors `turn/active.rs`'s `ACTIVE_TURN_STOP_BOUND` (private).
    const STOP_BOUND: Duration = Duration::from_secs(2);

    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            // A TERM-respecting dummy agent: the kill path itself is proven
            // against a TERM-IGNORING one by the tests above, so what this
            // case isolates is the BOUND, not the grace. Worst case in
            // production is the bound plus that 5s grace, which still fits
            // R4's 8s QUIESCE_DEADLINE.
            let RealChildActorHarness {
                actor,
                command_tx,
                command_rx,
                handle,
                mut prompt_responder_rx,
                mut cancel_rx,
                _store,
            } = spawn_actor_with_real_child("sleep 300").await;
            let agent_pid = actor.child.id().expect("agent pid") as i32;

            let (notification_tx, notification_rx) =
                mpsc::unbounded_channel::<acp::schema::SessionNotification>();
            let (background_tx, background_work_rx) =
                mpsc::unbounded_channel::<BackgroundWorkUpdate>();
            let _ = (notification_tx, background_tx);

            let actor_task = tokio::task::spawn_local(async move {
                actor
                    .run(command_rx, notification_rx, background_work_rx)
                    .await
            });

            // Drive the REAL idle loop into a REAL active turn.
            let (accept_tx, accept_rx) = oneshot::channel();
            command_tx
                .send(SessionCommand::Prompt {
                    payload: PromptPayload::text("start a turn nobody will finish".to_string()),
                    prompt_id: None,
                    from_queue_seq: None,
                    respond_to: accept_tx,
                })
                .await
                .expect("enqueue the prompt");
            let acceptance = tokio::time::timeout(Duration::from_secs(10), accept_rx)
                .await
                .expect("prompt accepted within the wait budget")
                .expect("prompt acceptance channel open")
                .expect("prompt started");
            assert!(
                matches!(acceptance, PromptAcceptance::Started { .. }),
                "expected a started turn, got {acceptance:?}"
            );
            // The prompt really reached the agent, and the responder is held
            // here - so the turn's prompt future can never resolve on its own.
            let _held_prompt_responder =
                tokio::time::timeout(Duration::from_secs(10), prompt_responder_rx.recv())
                    .await
                    .expect("prompt delivered to the fake agent")
                    .expect("prompt responder present");
            assert!(pid_is_alive(agent_pid), "dummy agent must be running");

            let started = tokio::time::Instant::now();
            let census = tokio::time::timeout(Duration::from_secs(20), handle.stop_and_await())
                .await
                .expect(
                    "an active-turn stop must be BOUNDED - an agent that ignores the cancel \
                     may not hold stop_and_await open for the length of its turn",
                )
                .expect("stop_and_await must succeed");
            let elapsed = started.elapsed();

            // The cancel WAS raced, not skipped: the agent received it and
            // simply did nothing about it.
            let cancel = tokio::time::timeout(Duration::from_secs(1), cancel_rx.recv())
                .await
                .expect("the ACP cancel must still be sent before the bound")
                .expect("cancel notification present");
            assert_eq!(&*cancel.session_id.0, NATIVE_SESSION_ID);

            assert!(
                census.0 >= 1,
                "the agent process must still be counted by the kill path: {census:?}"
            );
            assert!(
                !pid_is_alive(agent_pid),
                "the agent must be killed even though its turn never unwound"
            );
            assert!(
                elapsed >= STOP_BOUND,
                "the cancel must be given its bounded window before the escalation: {elapsed:?}"
            );
            assert!(
                elapsed < Duration::from_secs(6),
                "the stop must complete within the bound plus the kill path, well inside R4's \
                 8s QUIESCE_DEADLINE: {elapsed:?}"
            );

            actor_task
                .await
                .expect("actor task joined")
                .expect("actor run finished");
        })
        .await;
}

/// The re-entry contract, against the exact shape that broke it live on
/// 2026-08-13: a client POSTs `/v1/workspaces/{id}/archive`, disconnects
/// mid-quiesce, and axum drops the handler future — and with it the
/// `stop_and_await` future — while the actor is already past its idle loop
/// and deep in the kill escalation.
///
/// The stop itself is unaffected by that drop: the actor consumed the command
/// and owns the escalation from then on, which is the design. What must NOT
/// survive it is the actor's MAILBOX. The exit sequence is not instantaneous
/// (a TERM-ignoring agent guarantees at least the 5s grace here, and in
/// production an unreapable one guaranteed forever), and for its whole
/// duration the receiver used to be alive with nobody left to read it. Every
/// verb that arrived in that window — the archive's own re-POST, a plain
/// `dismiss` — was accepted into that mailbox and then waited on a oneshot
/// that no one would ever answer. Live symptom: `POST /v1/sessions/{id}/dismiss`
/// hung past 90s, and every retried archive died on the 8s quiesce deadline.
///
/// So the assertion is specifically about ANSWER LATENCY, not about
/// eventually answering. The 5s TERM grace is the separator: an actor that
/// only releases its mailbox when `run()` returns cannot answer inside it.
#[tokio::test]
async fn a_dropped_stop_future_leaves_the_session_answerable() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let dir = temp_dir("dropped-stop-reentry");
            // The same TERM-ignoring agent the group-kill test uses, and for
            // the same reason: `trap '' TERM` sets SIG_IGN, which is INHERITED
            // across fork+exec, so the backgrounded binary ignores the TERM
            // too and the whole group survives to the KILL. That makes the
            // exit sequence take a known ~5s (the grace), which is what turns
            // "the mailbox answers promptly" into a deterministic assertion
            // rather than a race against an exit that might be instant.
            let sleeper = compile_sleep_binary_named(&dir, "sleeper");
            let pidfile = dir.join("sleeper.pid");
            let script = format!(
                "trap '' TERM; {} 300 & echo $! > {} ; wait",
                sleeper.display(),
                pidfile.display()
            );

            let RealChildActorHarness {
                actor,
                command_tx,
                command_rx,
                handle,
                prompt_responder_rx: _prompt_responder_rx,
                cancel_rx: _cancel_rx,
                _store,
            } = spawn_actor_with_real_child(&script).await;
            let agent_pid = actor.child.id().expect("agent pid") as i32;
            let sleeper_pid = wait_for_pidfile(&pidfile).await;
            assert!(
                pid_is_alive(sleeper_pid),
                "the TERM-ignoring grandchild must be running"
            );
            let (notification_tx, notification_rx) =
                mpsc::unbounded_channel::<acp::schema::SessionNotification>();
            let (background_tx, background_work_rx) =
                mpsc::unbounded_channel::<BackgroundWorkUpdate>();
            let _ = (notification_tx, background_tx);
            assert!(pid_is_alive(agent_pid), "dummy agent must be running");

            let actor_task = tokio::task::spawn_local(async move {
                actor
                    .run(command_rx, notification_rx, background_work_rx)
                    .await
            });
            drop(command_tx.clone());

            // The archive's stop, abandoned mid-escalation. The timeout
            // expiring is the point: it proves the command was accepted and
            // the escalation is genuinely in flight when the future is
            // dropped, rather than the stop having quietly completed first.
            let interrupted =
                tokio::time::timeout(Duration::from_millis(500), handle.stop_and_await()).await;
            assert!(
                interrupted.is_err(),
                "the stop must still be in flight when its future is dropped, \
                 otherwise this test proves nothing about interruption; got {:?}",
                interrupted.map(|inner| inner.map_err(|error| error.to_string()))
            );

            // Everything below runs while the actor is still inside the 5s
            // grace, i.e. exactly the window that used to swallow verbs.
            let dismissed = tokio::time::timeout(Duration::from_secs(2), handle.dismiss()).await;
            assert!(
                dismissed.is_ok(),
                "dismiss hung on an actor that had already left its idle loop - \
                 the mailbox outlived the reader"
            );
            assert!(
                dismissed.expect("dismiss answered").is_err(),
                "an actor on its way out must READ as gone, not answer as if it were live"
            );

            // The archive's own re-entry verb, the one whose 8s deadline the
            // live incident kept tripping.
            let restopped =
                tokio::time::timeout(Duration::from_secs(2), handle.stop_and_await()).await;
            assert!(
                restopped.is_ok(),
                "a re-POSTed archive's stop_all_for_workspace hung on the same closed loop; \
                 this is the ARCHIVE_QUIESCE_TIMEOUT the deadline kept reporting"
            );
            assert!(
                restopped.expect("stop answered").is_err(),
                "a second stop must report the actor gone rather than a fresh census"
            );

            // The interruption must not have cost the kill: the escalation the
            // dropped future started still owns the process group and still
            // finishes, and `run()` still returns so its `on_exit` hook can
            // clear the handle out of the live-session map.
            let finished = tokio::time::timeout(Duration::from_secs(25), actor_task).await;
            finished
                .expect("the actor's exit sequence must terminate")
                .expect("actor task joined")
                .expect("actor run finished");
            assert!(
                !pid_is_alive(agent_pid),
                "the abandoned stop must still have killed the agent it started killing"
            );

            let _ = std::fs::remove_dir_all(&dir);
        })
        .await;
}
