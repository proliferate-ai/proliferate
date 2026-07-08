//! Per-run integration-gateway plumbing (PR E): the completion-ping sink
//! (§3.7/L16) and the session-launch injection of the per-run gateway MCP
//! server (§6.4/OPEN-3(a)).
//!
//! Both hang off the plan's [`PlanGateway`] block, which the server mints at
//! StartRun and threads through `resolved_plan_json.gateway`. The runtime never
//! mints or formats a credential — it forwards `gateway.authorization` verbatim
//! (matching the worker dotfile convention in
//! [`crate::integrations::integration_gateway`] and the gateway's own
//! `Bearer <token>` parsing).
//!
//! ## Launch injection reuses the existing seam (L8)
//!
//! There is no new injection concept: the per-run gateway rides the same
//! [`SessionExtension::resolve_launch_extras`] seam and the same
//! `SessionMcpServer::Http` shape the worker-dotfile extension builds
//! ([`crate::domains::sessions::mcp_bindings::integration_gateway`]). The
//! executor registers the per-run server in [`WorkflowGatewaySessions`] keyed by
//! session id *before* launch (mirroring how reviews/subagents register a
//! session between `create_durable_session` and `start_persisted_session`), and
//! [`WorkflowRunGatewaySessionLaunchExtension`] reads that registry at launch.
//! Keyed by session id (not workspace) so a co-located non-workflow session can
//! never inherit the run's credential.
//!
//! Precedence over the worker dotfile: the launch assembly dedupes MCP servers
//! by `connection_id`+`server_name`, keeping the first occurrence. Both the
//! per-run server and the dotfile server use [`INTEGRATION_GATEWAY_ID`], so
//! ordering this extension *before* the dotfile extension in the session
//! extension list makes the plan block win for workflow-owned sessions.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use crate::domains::sessions::extensions::{
    SessionExtension, SessionLaunchContext, SessionLaunchExtras,
};
use crate::domains::sessions::mcp_bindings::model::{
    SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
};
use crate::domains::sessions::model::SessionMcpBindingPolicy;
use crate::domains::workflows::plan::PlanGateway;
use crate::integrations::integration_gateway::INTEGRATION_GATEWAY_ID;

/// A short cap on the completion ping: the ping is a best-effort nudge, so it
/// must never tie up a task for long.
const PING_TIMEOUT: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------------------
// Completion ping (§3.7/L16)
// ---------------------------------------------------------------------------

/// Fire-and-forget sink for the per-run completion ping. Implementations MUST
/// NOT block: they return immediately, spawning the actual request internally
/// and ignoring its result. A failed ping never changes engine state — by the
/// time it fires the cursor has already moved; the ping only wakes the server's
/// existing refresh path.
pub trait RunPingSink: Send + Sync {
    /// Nudge `ping_url` with an empty-body `POST` carrying the given
    /// `Authorization` header value (verbatim). Returns immediately.
    fn fire(&self, ping_url: &str, authorization: &str);
}

/// The live HTTP ping sink: an empty-body `POST` with a short timeout, spawned
/// onto the current runtime and dropped on the floor.
pub struct HttpRunPingSink {
    client: reqwest::Client,
}

impl HttpRunPingSink {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }
}

impl Default for HttpRunPingSink {
    fn default() -> Self {
        Self::new()
    }
}

impl RunPingSink for HttpRunPingSink {
    fn fire(&self, ping_url: &str, authorization: &str) {
        let client = self.client.clone();
        let ping_url = ping_url.to_string();
        let authorization = authorization.to_string();
        // Fire-and-forget: spawn the request and ignore its outcome so a slow or
        // failing ping can never stall or fail the run.
        tokio::spawn(async move {
            let result = client
                .post(&ping_url)
                .header(reqwest::header::AUTHORIZATION, authorization)
                .timeout(PING_TIMEOUT)
                .send()
                .await;
            if let Err(error) = result {
                tracing::debug!(error = %error, "workflow run completion ping failed (ignored)");
            }
        });
    }
}

/// Fire the completion ping for a step transition, gated on the plan carrying a
/// gateway block. No gateway → no ping (nothing to nudge). Extracted so the
/// gating logic is unit-testable without the live executor.
pub fn fire_run_ping(gateway: Option<&PlanGateway>, sink: &dyn RunPingSink) {
    if let Some(gateway) = gateway {
        sink.fire(&gateway.ping_url, &gateway.authorization);
    }
}

// ---------------------------------------------------------------------------
// Per-run gateway MCP server injection (§6.4/OPEN-3(a))
// ---------------------------------------------------------------------------

/// Build the per-run gateway MCP server from the plan block, or `None` when the
/// block is absent or carries no usable credential. Uses the same
/// `SessionMcpServer::Http` shape and [`INTEGRATION_GATEWAY_ID`] as the worker
/// dotfile extension, with `authorization` forwarded verbatim.
pub fn workflow_gateway_server(gateway: Option<&PlanGateway>) -> Option<SessionMcpServer> {
    let gateway = gateway?;
    if gateway.authorization.trim().is_empty() || gateway.url.trim().is_empty() {
        return None;
    }
    Some(SessionMcpServer::Http(SessionMcpHttpServer {
        connection_id: INTEGRATION_GATEWAY_ID.to_string(),
        catalog_entry_id: None,
        server_name: INTEGRATION_GATEWAY_ID.to_string(),
        url: gateway.url.clone(),
        headers: vec![SessionMcpHeader {
            name: "authorization".to_string(),
            value: gateway.authorization.clone(),
        }],
    }))
}

/// Registry of per-run gateway MCP servers, keyed by session id. Written by the
/// workflow executor before it launches a workflow-owned session, read by
/// [`WorkflowRunGatewaySessionLaunchExtension`] at launch. Shared behind `Arc`
/// like [`super::exec_policy::WorkflowOwnedSessions`].
///
/// In-memory and grow-only for the runtime's lifetime; the executor re-registers
/// its current session on crash-resume (`hydrate_from_run`). Session ids are
/// never reused, so a stale entry cannot mis-target a later session.
#[derive(Default)]
pub struct WorkflowGatewaySessions {
    servers: RwLock<HashMap<String, SessionMcpServer>>,
}

impl WorkflowGatewaySessions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register the per-run gateway server for a session (idempotent overwrite).
    pub fn set(&self, session_id: &str, server: SessionMcpServer) {
        self.servers
            .write()
            .unwrap()
            .insert(session_id.to_string(), server);
    }

    /// The per-run gateway server for this session, if one was registered.
    pub fn get(&self, session_id: &str) -> Option<SessionMcpServer> {
        self.servers.read().unwrap().get(session_id).cloned()
    }
}

/// Session-launch extension that injects the per-run gateway MCP server for a
/// workflow-owned session. Reuses the existing launch-extension seam; must be
/// ordered before the worker-dotfile extension so the plan block wins on dedupe.
#[derive(Clone)]
pub struct WorkflowRunGatewaySessionLaunchExtension {
    sessions: Arc<WorkflowGatewaySessions>,
}

impl WorkflowRunGatewaySessionLaunchExtension {
    pub fn new(sessions: Arc<WorkflowGatewaySessions>) -> Self {
        Self { sessions }
    }
}

impl SessionExtension for WorkflowRunGatewaySessionLaunchExtension {
    fn resolve_launch_extras(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        // Same guard as the dotfile extension: internal-only sessions never
        // accept external MCP servers.
        if ctx.session.mcp_binding_policy == SessionMcpBindingPolicy::InternalOnly {
            return Ok(SessionLaunchExtras::default());
        }
        let Some(server) = self.sessions.get(&ctx.session.id) else {
            return Ok(SessionLaunchExtras::default());
        };
        tracing::info!(
            session_id = %ctx.session.id,
            "injecting per-run workflow gateway MCP server (plan block)"
        );
        Ok(SessionLaunchExtras {
            mcp_servers: vec![server],
            ..SessionLaunchExtras::default()
        })
    }
}

/// Test-only fakes shared with the actor's drive-loop tests.
#[cfg(test)]
pub(crate) mod test_support {
    use super::RunPingSink;
    use std::sync::Mutex;

    /// A recording ping sink for tier-1 tests: records every fired ping's
    /// (url, authorization) synchronously — no spawn — so assertions are
    /// deterministic and inert (a "failing" ping never propagates).
    #[derive(Default)]
    pub(crate) struct RecordingPingSink {
        pub calls: Mutex<Vec<(String, String)>>,
    }

    impl RecordingPingSink {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn count(&self) -> usize {
            self.calls.lock().unwrap().len()
        }
    }

    impl RunPingSink for RecordingPingSink {
        fn fire(&self, ping_url: &str, authorization: &str) {
            self.calls
                .lock()
                .unwrap()
                .push((ping_url.to_string(), authorization.to_string()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::RecordingPingSink;
    use super::*;

    fn gateway(integrations: Vec<String>) -> PlanGateway {
        PlanGateway {
            url: "https://cloud.test/mcp".to_string(),
            authorization: "Bearer per-run-secret".to_string(),
            ping_url: "https://cloud.test/runs/run-1/ping".to_string(),
            integrations,
        }
    }

    #[test]
    fn fire_run_ping_nudges_when_gateway_present() {
        let sink = RecordingPingSink::new();
        let gw = gateway(Vec::new());
        fire_run_ping(Some(&gw), &sink);
        let calls = sink.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "https://cloud.test/runs/run-1/ping");
        // Authorization forwarded verbatim (already the full `Bearer <token>`).
        assert_eq!(calls[0].1, "Bearer per-run-secret");
    }

    #[test]
    fn fire_run_ping_is_a_noop_without_a_gateway() {
        let sink = RecordingPingSink::new();
        fire_run_ping(None, &sink);
        assert_eq!(sink.count(), 0);
    }

    #[test]
    fn workflow_gateway_server_builds_http_server_verbatim() {
        let gw = gateway(vec!["issues".to_string()]);
        let SessionMcpServer::Http(server) =
            workflow_gateway_server(Some(&gw)).expect("server built")
        else {
            panic!("expected HTTP server");
        };
        assert_eq!(server.connection_id, INTEGRATION_GATEWAY_ID);
        assert_eq!(server.server_name, INTEGRATION_GATEWAY_ID);
        assert_eq!(server.url, "https://cloud.test/mcp");
        assert_eq!(server.headers.len(), 1);
        assert_eq!(server.headers[0].name, "authorization");
        assert_eq!(server.headers[0].value, "Bearer per-run-secret");
    }

    #[test]
    fn workflow_gateway_server_is_none_without_a_credential() {
        assert!(workflow_gateway_server(None).is_none());
        let mut gw = gateway(Vec::new());
        gw.authorization = "  ".to_string();
        assert!(workflow_gateway_server(Some(&gw)).is_none());
        let mut gw = gateway(Vec::new());
        gw.url = String::new();
        assert!(workflow_gateway_server(Some(&gw)).is_none());
    }

    #[test]
    fn registry_round_trips_a_server_by_session_id() {
        let registry = WorkflowGatewaySessions::new();
        assert!(registry.get("sess-1").is_none());
        let gw = gateway(Vec::new());
        registry.set("sess-1", workflow_gateway_server(Some(&gw)).unwrap());
        assert!(registry.get("sess-1").is_some());
        assert!(registry.get("sess-2").is_none());
    }

    // --- Contract fixture (fixtures/contracts/run-ping/) ------------------
    //
    // The consuming-side assertion (§3.7/L16 test obligation): the runtime
    // parses the golden gateway block and the ping request its sink emits
    // matches the golden ping-request shape. A change to either fixture breaks
    // this test until the runtime is updated in lock-step.

    fn fixture(name: &str) -> serde_json::Value {
        let path = format!(
            "{}/../../../fixtures/contracts/run-ping/{}",
            env!("CARGO_MANIFEST_DIR"),
            name
        );
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read fixture {path}: {e}"));
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse fixture {path}: {e}"))
    }

    #[test]
    fn parses_golden_gateway_block_and_emits_matching_ping() {
        let block = fixture("gateway-block.json");
        // The runtime parses resolved_plan_json.gateway into PlanGateway
        // (unknown `_comment` field ignored).
        let parsed: PlanGateway =
            serde_json::from_value(block.clone()).expect("gateway block parses into PlanGateway");
        assert_eq!(parsed.url, block["url"].as_str().unwrap());
        assert_eq!(parsed.authorization, block["authorization"].as_str().unwrap());
        assert_eq!(parsed.ping_url, block["ping_url"].as_str().unwrap());
        assert_eq!(parsed.integrations, vec!["issues", "slack"]);

        // The ping request the sink emits must match the golden ping-request:
        // same method/url/authorization, empty body.
        let ping = fixture("ping-request.json");
        // Method + body are fixed by HttpRunPingSink (POST, no body); assert the
        // fixture agrees so a server-side change to either forces a runtime fix.
        assert_eq!(ping["method"].as_str(), Some("POST"));
        assert!(ping["body"].is_null(), "completion ping carries an empty body");
        // url + authorization are what the runtime actually emits — assert via
        // the real fire path (recording sink), and cross-check against the
        // gateway block (a run's own token: run A can never ping run B).
        let sink = RecordingPingSink::new();
        fire_run_ping(Some(&parsed), &sink);
        let calls = sink.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        let (emitted_url, emitted_auth) = &calls[0];
        assert_eq!(emitted_url, ping["url"].as_str().unwrap());
        assert_eq!(emitted_url, &parsed.ping_url);
        assert_eq!(emitted_auth, ping["headers"]["authorization"].as_str().unwrap());
        assert_eq!(emitted_auth, &parsed.authorization);
    }
}
