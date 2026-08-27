//! Proofs for the seat tier-1 trial (founder ruling 2026-08-27): a dead seat
//! token drives the derived display to the red `Expired` terminal through the
//! REAL pipeline — HTTP classification → ledger → the probe engine's
//! `auth_runtime_inputs` fold (with its applied-seat scope guard) → the shared
//! facts derivation — and a live token reaches green `Authenticated` on trial
//! evidence, never on file presence.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

use chrono::Utc;

use crate::domains::agents::auth_state::{
    derive_agent_auth_state, facts_from_resolved_with_runtime, AuthDisplay, EvidenceRef,
    Tier1TrialFact,
};
use crate::domains::agents::launch_probe::config::ProbeEngineConfig;
use crate::domains::agents::launch_probe::test_support::{
    CountingPlanProducer, FakeRunner, FixedTargets, TempRuntimeHome,
};
use crate::domains::agents::launch_probe::LaunchProbeService;
use crate::domains::agents::model::{CredentialState, ResolvedAgent, ResolvedAgentStatus};

use super::seat_trial::SeatTrialLedger;

/// Deliberately dead: right shape, rejected by the (fake) API with 401.
const DEAD_TOKEN: &str = "sk-ant-oat01-deliberately-dead-testonly-0123456789abcdefgh";

/// A tiny HTTP server answering successive connections with the given statuses
/// (the last repeats). Captures the FIRST request's raw bytes for shape
/// assertions.
fn sequence_server(statuses: Vec<(u16, &'static str)>) -> (String, Arc<Mutex<Vec<u8>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind trial test server");
    let address = listener.local_addr().expect("test server address");
    let captured = Arc::new(Mutex::new(Vec::new()));
    let sink = captured.clone();
    std::thread::spawn(move || {
        let mut served = 0usize;
        while let Ok((mut stream, _)) = listener.accept() {
            let mut request = Vec::new();
            let mut buffer = [0u8; 4096];
            // Read until the header terminator plus the declared body length.
            loop {
                let Ok(read) = stream.read(&mut buffer) else {
                    break;
                };
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if let Some(headers_end) = find(&request, b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..headers_end]).to_lowercase();
                    let content_length = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .and_then(|value| value.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if request.len() >= headers_end + 4 + content_length {
                        break;
                    }
                }
            }
            if served == 0 {
                *sink.lock().expect("capture poisoned") = request;
            }
            let (status, reason) = statuses[served.min(statuses.len() - 1)];
            served += 1;
            let body = r#"{"type":"error"}"#;
            let _ = write!(
                stream,
                "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    (format!("http://{address}"), captured)
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn seat_state_json() -> serde_json::Value {
    serde_json::json!({
        "version": 2,
        "revision": 3,
        "harnesses": [{
            "harness_kind": "claude",
            "sources": [{
                "kind": "seat",
                "env": { "CLAUDE_CODE_OAUTH_TOKEN": "redacted-not-read-by-this-path" },
                "seat_id": "40000000-0000-4000-8000-000000000031",
            }],
        }],
    })
}

fn engine_with(home: &TempRuntimeHome, ledger: Arc<SeatTrialLedger>) -> LaunchProbeService {
    LaunchProbeService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec![])),
        Arc::new(FixedTargets::single("claude")),
        Arc::new(FakeRunner::new()),
        ProbeEngineConfig::default(),
    )
    .with_seat_trials(ledger)
}

/// A resolved claude whose credentials come from the applied route — the shape
/// a seat-selected harness resolves to (same construction as auth_state_tests).
fn seat_resolved() -> ResolvedAgent {
    use crate::domains::agents::readiness::service::resolve_agent_unrouted;
    use crate::domains::agents::registry::descriptor;
    let home = std::env::temp_dir();
    let desc = descriptor("claude").expect("claude descriptor");
    let mut resolved = resolve_agent_unrouted(&desc, &home);
    resolved.status = ResolvedAgentStatus::Ready;
    resolved.credentials_from_route = true;
    // A machine with the user's own native login present: exactly the shape
    // that produced the false green — it must not matter on a seat route.
    resolved.credential_state = CredentialState::ReadyViaLocalAuth;
    resolved
}

/// THE acceptance regression (2026-08-27): the pane said green while the seat
/// 401'd. A dead token must now drive the display to the red Expired terminal
/// through the full path — trial call, 401 classification, ledger, the probe
/// engine's fold, the shared derivation.
#[tokio::test]
async fn a_dead_token_drives_the_full_path_to_the_red_expired_state() {
    let home = TempRuntimeHome::new("seat-trial-dead");
    home.write_state_json(&seat_state_json());
    let (base_url, captured) = sequence_server(vec![(401, "Unauthorized")]);

    let ledger = Arc::new(SeatTrialLedger::with_base_url(&base_url));
    ledger.run_trial("claude", DEAD_TOKEN.to_string()).await;

    // The wire shape is the one a `user:inference` setup token is scoped for.
    let request = String::from_utf8_lossy(&captured.lock().expect("capture")).to_lowercase();
    assert!(request.starts_with("post /v1/messages"), "wrong endpoint");
    assert!(
        request.contains(&format!(
            "authorization: bearer {}",
            DEAD_TOKEN.to_lowercase()
        )),
        "the token must ride Authorization: Bearer"
    );
    assert!(request.contains("anthropic-beta: oauth-2025-04-20"));
    assert!(request.contains("anthropic-version: 2023-06-01"));
    assert!(request.contains("\"max_tokens\":1"), "one token, no more");

    let engine = engine_with(&home, ledger);
    let inputs = engine.auth_runtime_inputs("claude", Utc::now());
    assert_eq!(inputs.trial, Some(Tier1TrialFact::Expired));

    let facts = facts_from_resolved_with_runtime(&seat_resolved(), &inputs);
    let derived = derive_agent_auth_state(&facts);
    assert_eq!(
        derived.display,
        AuthDisplay::Expired,
        "a 401-ing seat must land on the red Expired terminal"
    );
}

/// The other side: a token the API accepts reaches green `Authenticated` on
/// TRIAL evidence (GatewayKeyCheck, with an age) — not on file presence.
#[tokio::test]
async fn a_live_token_reaches_green_authenticated_on_trial_evidence() {
    let home = TempRuntimeHome::new("seat-trial-live");
    home.write_state_json(&seat_state_json());
    let (base_url, _captured) = sequence_server(vec![(200, "OK")]);

    let ledger = Arc::new(SeatTrialLedger::with_base_url(&base_url));
    ledger
        .run_trial(
            "claude",
            "sk-ant-oat01-live-testonly-0123456789abcdefghij".to_string(),
        )
        .await;

    let engine = engine_with(&home, ledger);
    let inputs = engine.auth_runtime_inputs("claude", Utc::now());
    assert!(matches!(inputs.trial, Some(Tier1TrialFact::Green { .. })));

    let derived =
        derive_agent_auth_state(&facts_from_resolved_with_runtime(&seat_resolved(), &inputs));
    assert_eq!(derived.display, AuthDisplay::Authenticated);
    assert_eq!(derived.evidence_ref, Some(EvidenceRef::GatewayKeyCheck));
    assert!(derived.evidence_age_seconds.is_some());
}

/// Transport failures and non-auth statuses record NOTHING, and a re-mint's
/// inconclusive trial CLEARS the previous token's verdict — the display stays
/// the honest acknowledged-route state, claiming neither green nor expired.
#[tokio::test]
async fn an_inconclusive_trial_records_nothing_and_clears_a_stale_verdict() {
    let home = TempRuntimeHome::new("seat-trial-inconclusive");
    home.write_state_json(&seat_state_json());
    let (base_url, _captured) =
        sequence_server(vec![(401, "Unauthorized"), (500, "Internal Server Error")]);
    let ledger = Arc::new(SeatTrialLedger::with_base_url(&base_url));

    // Mint 1: a dead token leaves a Rejected verdict.
    ledger.run_trial("claude", DEAD_TOKEN.to_string()).await;
    let engine = engine_with(&home, ledger.clone());
    assert_eq!(
        engine.auth_runtime_inputs("claude", Utc::now()).trial,
        Some(Tier1TrialFact::Expired),
        "sanity: the stale verdict exists before the re-mint"
    );

    // Mint 2: the API answers 500 for the NEW token — learned nothing, and the
    // old verdict (which judged a different token) must not linger.
    ledger
        .run_trial(
            "claude",
            "sk-ant-oat01-second-testonly-0123456789abcdefghij".to_string(),
        )
        .await;
    let inputs = engine.auth_runtime_inputs("claude", Utc::now());
    assert_eq!(inputs.trial, None, "inconclusive must leave absence");

    let derived =
        derive_agent_auth_state(&facts_from_resolved_with_runtime(&seat_resolved(), &inputs));
    assert_eq!(derived.display, AuthDisplay::Selected);
    assert!(!derived.display.is_green());
}

/// The scope guard: a seat verdict folds ONLY while the applied route selects
/// a seat. A native machine (no state file) and a gateway route must both see
/// `None` — native is a permanently supported method (founder ruling) and seat
/// machinery must never color it.
#[tokio::test]
async fn a_seat_verdict_never_colors_a_non_seat_route() {
    let (base_url, _captured) = sequence_server(vec![(401, "Unauthorized")]);
    let ledger = Arc::new(SeatTrialLedger::with_base_url(&base_url));
    ledger.run_trial("claude", DEAD_TOKEN.to_string()).await;

    // No state file at all: the native world.
    let native_home = TempRuntimeHome::new("seat-trial-native");
    let engine = engine_with(&native_home, ledger.clone());
    assert_eq!(engine.auth_runtime_inputs("claude", Utc::now()).trial, None);

    // A gateway route for the same harness.
    let gateway_home = TempRuntimeHome::new("seat-trial-gateway");
    gateway_home.write_state_json(&serde_json::json!({
        "version": 2,
        "revision": 4,
        "harnesses": [{
            "harness_kind": "claude",
            "sources": [{
                "kind": "gateway",
                "base_url": "https://gw.example",
                "key": "vk-test",
            }],
        }],
    }));
    let engine = engine_with(&gateway_home, ledger);
    assert_eq!(engine.auth_runtime_inputs("claude", Utc::now()).trial, None);
}
