use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionActionCapabilities, SessionExecutionPhase};
use tokio::sync::oneshot;

use crate::domains::sessions::mcp_bindings::acp::to_acp_servers;
use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;
use crate::domains::sessions::runtime::opencode_sidedoor_client::OpencodeSidedoorClient;
use crate::live::sessions::actor::command::{
    ForkSessionCommandError, ForkSessionCommandResult, SessionCommand, SidedoorForkCommandError,
    SidedoorForkCommandResult,
};
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::driver::opencode_sidedoor::SidedoorRuntime;
use crate::live::sessions::driver::shutdown::close_native_session;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::QueueDurable;

impl SessionActor {
    pub(in crate::live::sessions::actor) async fn handle_idle_fork_lifecycle_command(
        &self,
        command: SessionCommand,
    ) {
        match command {
            SessionCommand::VerifyForkReady { respond_to } => {
                let result = verify_fork_ready(
                    &self.handle,
                    self.caps.queue.as_ref(),
                    &self.session_id,
                    self.action_capabilities,
                )
                .await;
                let _ = respond_to.send(result);
            }
            SessionCommand::Fork { respond_to } => {
                let result = fork_native_session(
                    &self.conn,
                    &self.native_session_id,
                    &self.workspace_path,
                    &self.mcp_servers,
                    &self.handle,
                    self.caps.queue.as_ref(),
                    &self.session_id,
                    self.action_capabilities,
                    self.supports_native_close,
                )
                .await;
                let _ = respond_to.send(result);
            }
            SessionCommand::SidedoorTargetedFork {
                vendor_message_id,
                respond_to,
            } => {
                let result = sidedoor_targeted_fork(
                    self.sidedoor.as_ref(),
                    &self.native_session_id,
                    &vendor_message_id,
                    self.supports_native_close,
                )
                .await;
                let _ = respond_to.send(result);
            }
            SessionCommand::CloseNativeSession {
                native_session_id,
                respond_to,
            } => {
                handle_close_native_child_session(
                    &self.conn,
                    native_session_id,
                    self.supports_native_close,
                    respond_to,
                )
                .await;
            }
            _ => unreachable!("non-fork command routed to fork lifecycle handler"),
        }
    }
}

pub(in crate::live::sessions::actor) async fn fork_native_session(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    workspace_path: &std::path::PathBuf,
    mcp_servers: &[SessionMcpServer],
    handle: &Arc<LiveSessionHandle>,
    store: &dyn QueueDurable,
    session_id: &str,
    action_capabilities: SessionActionCapabilities,
    supports_close: bool,
) -> Result<ForkSessionCommandResult, ForkSessionCommandError> {
    verify_fork_ready(handle, store, session_id, action_capabilities).await?;

    let mut request =
        acp::schema::ForkSessionRequest::new(native_session_id.to_string(), workspace_path.clone());
    if !mcp_servers.is_empty() {
        request = request.mcp_servers(to_acp_servers(mcp_servers));
    }
    let response = conn
        .send_request(request)
        .block_task()
        .await
        .map_err(|error| ForkSessionCommandError::Failed(error.to_string()))?;
    Ok(ForkSessionCommandResult {
        native_session_id: response.session_id.to_string(),
        supports_close,
    })
}

/// The OpenCode side-door targeted-fork actor operation. Runs on
/// the parent actor because the side-door state (port + password + readiness)
/// is process-local. Never dispatches an unvalidated id: the vendor does no
/// existence check and would silently full-copy an unknown id, so this
/// pre-validates the exact id via `get_message` (must be role "user") AND
/// `list_messages` membership BEFORE any fork POST.
pub(in crate::live::sessions::actor) async fn sidedoor_targeted_fork(
    sidedoor: Option<&SidedoorRuntime>,
    native_session_id: &str,
    vendor_message_id: &str,
    supports_close: bool,
) -> Result<SidedoorForkCommandResult, SidedoorForkCommandError> {
    // A non-Ready side-door at dispatch time is a hard error, never a silent
    // tip fork.
    let runtime = sidedoor.filter(|runtime| runtime.is_ready()).ok_or_else(|| {
        SidedoorForkCommandError::NotReady(
            "OpenCode side-door is not ready for targeted fork dispatch".to_string(),
        )
    })?;
    let client = OpencodeSidedoorClient::new(runtime.config.port, runtime.config.password.clone())
        .map_err(|error| SidedoorForkCommandError::Failed(error.to_string()))?;

    // Pre-validation gate 1: the id must resolve to a user message.
    let message = client
        .get_message(native_session_id, vendor_message_id)
        .await
        .map_err(|_| SidedoorForkCommandError::TargetNotFound)?;
    if message.info.role != "user" {
        return Err(SidedoorForkCommandError::TargetNotFound);
    }
    if message.info.id != vendor_message_id {
        return Err(SidedoorForkCommandError::InvalidForkTarget(
            "vendor returned a different message id than requested".to_string(),
        ));
    }
    // Pre-validation gate 2: the id must be present in the message listing.
    let listing = client
        .list_messages(native_session_id)
        .await
        .map_err(|error| SidedoorForkCommandError::Failed(error.to_string()))?;
    if !listing
        .iter()
        .any(|envelope| envelope.info.id == vendor_message_id)
    {
        return Err(SidedoorForkCommandError::InvalidForkTarget(
            "target message id not present in vendor listing".to_string(),
        ));
    }

    // Validated: dispatch the fork POST.
    let forked = client
        .fork(native_session_id, Some(vendor_message_id))
        .await
        .map_err(|error| SidedoorForkCommandError::Failed(error.to_string()))?;
    Ok(SidedoorForkCommandResult {
        native_session_id: forked.id,
        supports_close,
    })
}

pub(in crate::live::sessions::actor) async fn verify_fork_ready(
    handle: &Arc<LiveSessionHandle>,
    store: &dyn QueueDurable,
    session_id: &str,
    action_capabilities: SessionActionCapabilities,
) -> Result<(), ForkSessionCommandError> {
    if !action_capabilities.fork {
        return Err(ForkSessionCommandError::Unsupported(
            "agent does not advertise ACP session/fork with load_session support".to_string(),
        ));
    }
    if handle.is_busy() {
        return Err(ForkSessionCommandError::Busy);
    }
    let execution = handle.execution_snapshot().await;
    if execution.phase != SessionExecutionPhase::Idle || !execution.pending_interactions.is_empty()
    {
        return Err(ForkSessionCommandError::Busy);
    }
    match store.peek_head_pending_prompt(session_id) {
        Ok(Some(_)) => return Err(ForkSessionCommandError::Busy),
        Ok(None) => {}
        Err(error) => {
            return Err(ForkSessionCommandError::Failed(format!(
                "failed to inspect pending prompt queue before fork: {error}"
            )));
        }
    }

    Ok(())
}

pub(in crate::live::sessions::actor) async fn close_native_child_session(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    supports_close: bool,
) -> anyhow::Result<()> {
    close_native_session(conn, native_session_id, supports_close).await
}

pub(in crate::live::sessions::actor) async fn handle_close_native_child_session(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: String,
    supports_close: bool,
    respond_to: oneshot::Sender<anyhow::Result<()>>,
) {
    let result = close_native_child_session(conn, &native_session_id, supports_close).await;
    let _ = respond_to.send(result);
}

pub(in crate::live::sessions::actor) fn reject_busy_close_native_child_session(
    respond_to: oneshot::Sender<anyhow::Result<()>>,
) {
    let _ = respond_to.send(Err(anyhow::anyhow!(
        "cannot close native child session while parent session is busy"
    )));
}

#[cfg(test)]
mod sidedoor_fork_tests {
    //! Pre-validation matrix and dispatch contract for the
    //! OpenCode side-door targeted fork, exercised against an in-process fake
    //! side-door HTTP server (std `TcpListener`). The cardinal sin the vendor
    //! commits — silently full-copying an unknown message id — means every one
    //! of these paths MUST hard-error rather than dispatch unvalidated.

    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    use super::{sidedoor_targeted_fork, SidedoorForkCommandError};
    use crate::live::sessions::driver::opencode_sidedoor::{
        SidedoorRuntime, SidedoorSpawnConfig, SidedoorState,
    };

    /// Fake side-door behavior. `messages` maps a message id to the role
    /// `get_message` reports (absent ⇒ 404); `listing` is what
    /// `list_messages` returns.
    #[derive(Clone)]
    struct Scenario {
        messages: HashMap<String, String>,
        listing: Vec<String>,
    }

    /// Spawns a detached fake side-door server on loopback. Returns the bound
    /// port and a handle to the recorded fork request bodies. The server loops
    /// forever serving connections; the test process reaps the thread on exit.
    fn spawn_fake_sidedoor(scenario: Scenario) -> (u16, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake side-door");
        let port = listener.local_addr().expect("addr").port();
        let bodies: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let bodies_for_thread = bodies.clone();
        std::thread::spawn(move || {
            let mut child_counter = 0u32;
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 2048];
                // Read until we have the header terminator, then any body.
                let header_end = loop {
                    let read = match stream.read(&mut chunk) {
                        Ok(0) => break None,
                        Ok(n) => n,
                        Err(_) => break None,
                    };
                    buf.extend_from_slice(&chunk[..read]);
                    if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
                        break Some(pos);
                    }
                };
                let Some(header_end) = header_end else { continue };
                let headers = String::from_utf8_lossy(&buf[..header_end]).to_string();
                let request_line = headers.lines().next().unwrap_or_default().to_string();
                let mut parts = request_line.split_whitespace();
                let method = parts.next().unwrap_or_default().to_string();
                let path = parts.next().unwrap_or_default().to_string();

                // Read the rest of the body per Content-Length (POST fork).
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let lower = line.to_ascii_lowercase();
                        lower
                            .strip_prefix("content-length:")
                            .map(|value| value.trim().parse::<usize>().unwrap_or(0))
                    })
                    .unwrap_or(0);
                let mut body = buf[header_end + 4..].to_vec();
                while body.len() < content_length {
                    let read = match stream.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(n) => n,
                        Err(_) => break,
                    };
                    body.extend_from_slice(&chunk[..read]);
                }

                let response = route(
                    &method,
                    &path,
                    &body,
                    &scenario,
                    &bodies_for_thread,
                    &mut child_counter,
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (port, bodies)
    }

    fn route(
        method: &str,
        path: &str,
        body: &[u8],
        scenario: &Scenario,
        bodies: &Arc<Mutex<Vec<String>>>,
        child_counter: &mut u32,
    ) -> String {
        // POST /session/{id}/fork
        if method == "POST" && path.ends_with("/fork") {
            bodies
                .lock()
                .expect("bodies lock")
                .push(String::from_utf8_lossy(body).to_string());
            *child_counter += 1;
            let child_id = format!("child_{child_counter}");
            return json_ok(&format!("{{\"id\":\"{child_id}\"}}"));
        }
        // GET /session/{id}/message  (listing)  — no trailing message id.
        if method == "GET" && path.ends_with("/message") {
            let items: Vec<String> = scenario
                .listing
                .iter()
                .map(|id| {
                    let role = scenario.messages.get(id).cloned().unwrap_or_else(|| "user".to_string());
                    format!("{{\"info\":{{\"id\":\"{id}\",\"role\":\"{role}\"}}}}")
                })
                .collect();
            return json_ok(&format!("[{}]", items.join(",")));
        }
        // GET /session/{id}/message/{messageID}
        if method == "GET" {
            if let Some(message_id) = path.rsplit('/').next() {
                if let Some(role) = scenario.messages.get(message_id) {
                    return json_ok(&format!(
                        "{{\"info\":{{\"id\":\"{message_id}\",\"role\":\"{role}\"}}}}"
                    ));
                }
                return not_found();
            }
        }
        not_found()
    }

    fn json_ok(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
    }

    fn not_found() -> String {
        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
    }

    fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    }

    fn ready_runtime(port: u16) -> SidedoorRuntime {
        SidedoorRuntime {
            config: SidedoorSpawnConfig {
                port,
                password: "test-password-0000000000000000".to_string(),
            },
            state: SidedoorState::Ready { port },
        }
    }

    fn user_scenario(id: &str) -> Scenario {
        let mut messages = HashMap::new();
        messages.insert(id.to_string(), "user".to_string());
        Scenario {
            messages,
            listing: vec![id.to_string()],
        }
    }

    #[tokio::test]
    async fn happy_path_validates_and_dispatches() {
        let (port, bodies) = spawn_fake_sidedoor(user_scenario("msg_target"));
        let runtime = ready_runtime(port);
        let result =
            sidedoor_targeted_fork(Some(&runtime), "native_session", "msg_target", true)
                .await
                .expect("validated fork dispatches");
        assert_eq!(result.native_session_id, "child_1");
        let recorded = bodies.lock().expect("bodies");
        assert_eq!(recorded.len(), 1);
        assert!(recorded[0].contains("\"messageID\":\"msg_target\""));
    }

    #[tokio::test]
    async fn absent_message_is_target_not_found() {
        // get_message 404: the id does not exist on the vendor at all.
        let (port, _bodies) = spawn_fake_sidedoor(Scenario {
            messages: HashMap::new(),
            listing: vec![],
        });
        let runtime = ready_runtime(port);
        let error = sidedoor_targeted_fork(Some(&runtime), "native_session", "msg_missing", true)
            .await
            .expect_err("absent id must hard-error");
        assert!(matches!(error, SidedoorForkCommandError::TargetNotFound));
    }

    #[tokio::test]
    async fn non_user_role_is_target_not_found() {
        let mut messages = HashMap::new();
        messages.insert("msg_assistant".to_string(), "assistant".to_string());
        let (port, _bodies) = spawn_fake_sidedoor(Scenario {
            messages,
            listing: vec!["msg_assistant".to_string()],
        });
        let runtime = ready_runtime(port);
        let error = sidedoor_targeted_fork(Some(&runtime), "native_session", "msg_assistant", true)
            .await
            .expect_err("non-user role must hard-error");
        assert!(matches!(error, SidedoorForkCommandError::TargetNotFound));
    }

    #[tokio::test]
    async fn absent_from_listing_is_invalid_fork_target() {
        // get_message resolves the id as a user message, but the listing omits
        // it — the membership contract fails, so never dispatch.
        let mut messages = HashMap::new();
        messages.insert("msg_ghost".to_string(), "user".to_string());
        let (port, bodies) = spawn_fake_sidedoor(Scenario {
            messages,
            listing: vec![],
        });
        let runtime = ready_runtime(port);
        let error = sidedoor_targeted_fork(Some(&runtime), "native_session", "msg_ghost", true)
            .await
            .expect_err("listing mismatch must hard-error");
        assert!(matches!(
            error,
            SidedoorForkCommandError::InvalidForkTarget(_)
        ));
        assert!(bodies.lock().expect("bodies").is_empty(), "must not dispatch");
    }

    #[tokio::test]
    async fn two_boundaries_produce_distinct_dispatches() {
        let mut messages = HashMap::new();
        messages.insert("msg_one".to_string(), "user".to_string());
        messages.insert("msg_two".to_string(), "user".to_string());
        let (port, bodies) = spawn_fake_sidedoor(Scenario {
            messages,
            listing: vec!["msg_one".to_string(), "msg_two".to_string()],
        });
        let runtime = ready_runtime(port);
        let first = sidedoor_targeted_fork(Some(&runtime), "native_session", "msg_one", true)
            .await
            .expect("first fork");
        let second = sidedoor_targeted_fork(Some(&runtime), "native_session", "msg_two", true)
            .await
            .expect("second fork");
        assert_ne!(first.native_session_id, second.native_session_id);
        let recorded = bodies.lock().expect("bodies");
        assert_eq!(recorded.len(), 2);
        assert!(recorded[0].contains("\"messageID\":\"msg_one\""));
        assert!(recorded[1].contains("\"messageID\":\"msg_two\""));
    }

    #[tokio::test]
    async fn non_ready_side_door_is_hard_error_not_tip_fork() {
        let runtime = SidedoorRuntime {
            config: SidedoorSpawnConfig {
                port: 1,
                password: "unused".to_string(),
            },
            state: SidedoorState::Unavailable,
        };
        let error = sidedoor_targeted_fork(Some(&runtime), "native_session", "msg_target", true)
            .await
            .expect_err("non-ready side-door must hard-error");
        assert!(matches!(error, SidedoorForkCommandError::NotReady(_)));
    }

    #[tokio::test]
    async fn absent_side_door_is_hard_error() {
        let error = sidedoor_targeted_fork(None, "native_session", "msg_target", true)
            .await
            .expect_err("missing side-door must hard-error");
        assert!(matches!(error, SidedoorForkCommandError::NotReady(_)));
    }

    /// The vendor's first silent-failure direction (Q-C4): a messageID sorting
    /// lexicographically AFTER every real id makes upstream `Session.fork`
    /// run its ascending copy loop to completion and silently FULL-COPY the
    /// session. Our exact-membership guard is ordering-blind, so an id the
    /// vendor never issued is rejected before any POST — the full copy can
    /// never happen through the bridge.
    #[tokio::test]
    async fn unknown_id_sorting_after_all_real_ids_never_dispatches() {
        let mut messages = HashMap::new();
        messages.insert("msg_00000000000aaa".to_string(), "user".to_string());
        messages.insert("msg_00000000000bbb".to_string(), "user".to_string());
        let (port, bodies) = spawn_fake_sidedoor(Scenario {
            messages,
            listing: vec![
                "msg_00000000000aaa".to_string(),
                "msg_00000000000bbb".to_string(),
            ],
        });
        let runtime = ready_runtime(port);
        // Sorts after every real id; upstream would full-copy on this id.
        let error = sidedoor_targeted_fork(Some(&runtime), "native_session", "msg_zzzzzzzzzzzzzz", true)
            .await
            .expect_err("an id sorting after all real ids must hard-error, never full-copy");
        assert!(matches!(error, SidedoorForkCommandError::TargetNotFound));
        assert!(
            bodies.lock().expect("bodies").is_empty(),
            "the silent full-copy path must never be reached"
        );
    }

    /// The vendor's second silent-failure direction (Q-C4, new hazard beyond
    /// the frozen record): a messageID sorting BEFORE every real id breaks the
    /// copy loop on the first iteration and silently produces a near-EMPTY
    /// fork. Same guard, opposite direction — rejected before dispatch.
    #[tokio::test]
    async fn unknown_id_sorting_before_all_real_ids_never_dispatches() {
        let mut messages = HashMap::new();
        messages.insert("msg_zzzzzzzzzzzaaa".to_string(), "user".to_string());
        messages.insert("msg_zzzzzzzzzzzbbb".to_string(), "user".to_string());
        let (port, bodies) = spawn_fake_sidedoor(Scenario {
            messages,
            listing: vec![
                "msg_zzzzzzzzzzzaaa".to_string(),
                "msg_zzzzzzzzzzzbbb".to_string(),
            ],
        });
        let runtime = ready_runtime(port);
        // Sorts before every real id; upstream would near-empty-fork on this id.
        let error = sidedoor_targeted_fork(Some(&runtime), "native_session", "msg_0000000000000", true)
            .await
            .expect_err("an id sorting before all real ids must hard-error, never near-empty-fork");
        assert!(matches!(error, SidedoorForkCommandError::TargetNotFound));
        assert!(
            bodies.lock().expect("bodies").is_empty(),
            "the silent near-empty-fork path must never be reached"
        );
    }

    /// A validated dispatch ALWAYS carries an explicit messageID in the fork
    /// body — the bridge never relies on the vendor's optional-field tip-fork
    /// default for a targeted fork. The dispatch signature takes `&str`, not
    /// `Option`, so omission is structurally impossible; this pins the wire
    /// shape that proves it (an omitted id would be a bodyless `{}` tip fork).
    #[tokio::test]
    async fn targeted_dispatch_always_sends_an_explicit_message_id() {
        let (port, bodies) = spawn_fake_sidedoor(user_scenario("msg_target"));
        let runtime = ready_runtime(port);
        sidedoor_targeted_fork(Some(&runtime), "native_session", "msg_target", true)
            .await
            .expect("validated fork dispatches");
        let recorded = bodies.lock().expect("bodies");
        assert_eq!(recorded.len(), 1);
        assert!(
            recorded[0].contains("\"messageID\":\"msg_target\""),
            "targeted fork body must carry the explicit messageID, never an omitted tip default"
        );
    }
}
