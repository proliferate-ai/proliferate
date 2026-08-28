//! Proofs for the seat tier-1 trial (founder ruling 2026-08-27): a dead seat
//! token drives the harness's STATUS DOCUMENT to the red `failed` verdict
//! through the REAL pipeline — HTTP classification → ledger → the probe
//! engine's fold (with its applied-seat scope guard) → the persisted document
//! — and a live token reaches a dated `verified`, never on file presence.
//!
//! The fold's destination is what the slice-3 forward merge moved. The
//! verdict used to ride `AuthRuntimeInputs.trial` into the client-side
//! derivation; that derivation is deleted and the status document is the one
//! machine truth, so the trial lands as the credentialed observation it is.
//! Everything the ruling fixed is asserted here on the new destination:
//! classification, the wire shape, "inconclusive records nothing", and the
//! scope guard that keeps seat machinery off a gateway or native route.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

use chrono::Utc;

use crate::domains::agents::launch_probe::config::ProbeEngineConfig;
use crate::domains::agents::launch_probe::test_support::{
    CountingPlanProducer, FakeRunner, FixedTargets, TempRuntimeHome,
};
use crate::domains::agents::launch_probe::LaunchProbeService;
use crate::domains::agents::status::{AgentStatusService, ProbeVerdict, StatusDoc};
use crate::persistence::Db;

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
            while let Ok(read) = stream.read(&mut buffer) {
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
        "lineage": "seat-trial-lineage",
        "sequence": 3,
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

/// An engine wired exactly as production wires it for this path: the ledger it
/// runs the trial through, and the status service the verdict must reach.
fn engine_with(
    home: &TempRuntimeHome,
    ledger: Arc<SeatTrialLedger>,
) -> (LaunchProbeService, Arc<AgentStatusService>) {
    let status = Arc::new(AgentStatusService::with_parts(
        Db::open(home.path()).expect("open db"),
        home.path().to_path_buf(),
        Arc::new(FixedTargets::single("claude")),
        vec!["claude".to_string()],
        home.path().join("detection-home"),
    ));
    let engine = LaunchProbeService::with_parts(
        home.path().to_path_buf(),
        Arc::new(CountingPlanProducer::new(vec![])),
        Arc::new(FixedTargets::single("claude")),
        Arc::new(FakeRunner::new()),
        ProbeEngineConfig::default(),
    )
    .with_seat_trials(ledger)
    .with_agent_status(status.clone());
    (engine, status)
}

fn claude_doc(status: &Arc<AgentStatusService>) -> Option<StatusDoc> {
    status.read("claude")
}

/// THE acceptance regression (2026-08-27): the pane said green while the seat
/// 401'd. A dead token must now drive the document to the red `failed` verdict
/// through the full path — trial call, 401 classification, ledger, the engine's
/// fold, the persisted status document.
#[tokio::test]
async fn a_dead_token_drives_the_full_path_to_a_failed_status_document() {
    let home = TempRuntimeHome::new("seat-trial-dead");
    home.write_state_json(&seat_state_json());
    let (base_url, captured) = sequence_server(vec![(401, "Unauthorized")]);

    let ledger = Arc::new(SeatTrialLedger::with_base_url(&base_url));
    let (engine, status) = engine_with(&home, ledger);
    engine
        .run_seat_trial("claude", DEAD_TOKEN.to_string())
        .await;

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

    let doc = claude_doc(&status).expect("the fold composed a document");
    assert_eq!(
        doc.probe.verdict,
        ProbeVerdict::Failed,
        "a 401-ing seat must land on the red failed verdict"
    );
    assert!(doc.probe.at.is_some(), "the failure is dated");
    // The seat STAYS SAVED (spec flow 2): only the light dims.
    assert!(
        doc.methods
            .iter()
            .any(|row| row.kind == "seat" && row.seat_id.is_some()),
        "the seat row survives its own failed trial: {doc:?}"
    );
}

/// The other side: a token the API accepts reaches a dated `verified` on TRIAL
/// evidence — not on file presence.
#[tokio::test]
async fn a_live_token_reaches_a_dated_verified_status_document() {
    let home = TempRuntimeHome::new("seat-trial-live");
    home.write_state_json(&seat_state_json());
    let (base_url, _captured) = sequence_server(vec![(200, "OK")]);

    let ledger = Arc::new(SeatTrialLedger::with_base_url(&base_url));
    let (engine, status) = engine_with(&home, ledger);
    engine
        .run_seat_trial(
            "claude",
            "sk-ant-oat01-live-testonly-0123456789abcdefghij".to_string(),
        )
        .await;

    let doc = claude_doc(&status).expect("the fold composed a document");
    assert_eq!(doc.probe.verdict, ProbeVerdict::Verified);
    assert!(
        doc.probe.at.is_some(),
        "green needs dated evidence: {doc:?}"
    );
}

/// Transport failures and non-auth statuses record NOTHING, and a re-mint's
/// inconclusive trial CLEARS the previous token's verdict — the document keeps
/// the last real observation instead of claiming a new one.
#[tokio::test]
async fn an_inconclusive_trial_records_nothing_and_clears_a_stale_verdict() {
    let home = TempRuntimeHome::new("seat-trial-inconclusive");
    home.write_state_json(&seat_state_json());
    let (base_url, _captured) =
        sequence_server(vec![(401, "Unauthorized"), (500, "Internal Server Error")]);
    let ledger = Arc::new(SeatTrialLedger::with_base_url(&base_url));
    let (engine, status) = engine_with(&home, ledger.clone());

    // Mint 1: a dead token leaves a Rejected verdict, folded onto the document.
    engine
        .run_seat_trial("claude", DEAD_TOKEN.to_string())
        .await;
    assert_eq!(
        claude_doc(&status).expect("document").probe.verdict,
        ProbeVerdict::Failed,
        "sanity: the verdict landed before the re-mint"
    );

    // Mint 2: the API answers 500 for the NEW token — learned nothing, and the
    // old verdict (which judged a different token) must not linger in the
    // ledger and re-assert itself as a fresh observation.
    engine
        .run_seat_trial(
            "claude",
            "sk-ant-oat01-second-testonly-0123456789abcdefghij".to_string(),
        )
        .await;
    assert_eq!(
        ledger.verdict_for_applied_seat(home.path(), "claude", Utc::now()),
        None,
        "inconclusive must leave absence in the ledger"
    );
}

/// The scope guard: a seat verdict folds ONLY while the applied route selects
/// a seat. A native machine (no state file) and a gateway route must both be
/// left alone — native is a permanently supported method (founder ruling) and
/// seat machinery must never color it.
#[tokio::test]
async fn a_seat_verdict_never_colors_a_non_seat_route() {
    let (base_url, _captured) = sequence_server(vec![(401, "Unauthorized")]);

    // No state file at all: the native world.
    let native_home = TempRuntimeHome::new("seat-trial-native");
    let native_ledger = Arc::new(SeatTrialLedger::with_base_url(&base_url));
    let (engine, status) = engine_with(&native_home, native_ledger);
    engine
        .run_seat_trial("claude", DEAD_TOKEN.to_string())
        .await;
    assert!(
        claude_doc(&status).is_none_or(|doc| doc.probe.verdict != ProbeVerdict::Failed),
        "a seat verdict must not fail a native harness's document"
    );

    // A gateway route for the same harness.
    let gateway_home = TempRuntimeHome::new("seat-trial-gateway");
    gateway_home.write_state_json(&serde_json::json!({
        "version": 2,
        "lineage": "seat-trial-lineage",
        "sequence": 4,
        "harnesses": [{
            "harness_kind": "claude",
            "sources": [{
                "kind": "gateway",
                "base_url": "https://gw.example",
                "key": "vk-test",
            }],
        }],
    }));
    let gateway_ledger = Arc::new(SeatTrialLedger::with_base_url(&base_url));
    let (engine, status) = engine_with(&gateway_home, gateway_ledger);
    engine
        .run_seat_trial("claude", DEAD_TOKEN.to_string())
        .await;
    assert!(
        claude_doc(&status).is_none_or(|doc| doc.probe.verdict != ProbeVerdict::Failed),
        "a seat verdict must not fail a gateway harness's document"
    );
}
