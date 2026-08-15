//! Tier-1 trial: verdict mapping (green with age / expired on 401), the flag
//! gate, and single-flight, proven against a stubbed check seam and a raw local
//! HTTP stub for the gateway admin surface (no live network, no mock-LLM).

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;

use chrono::Utc;

use super::{
    HttpTier1TrialProbe, Tier1TrialCheck, Tier1TrialEngine, Tier1TrialProbe, Tier1TrialVerdict,
};
use crate::domains::agents::auth_state::Tier1TrialFact;

/// A stub check seam that answers with a fixed verdict, so the engine's verdict
/// mapping and recording are testable without any network.
struct StubProbe(Tier1TrialCheck);

#[async_trait::async_trait]
impl Tier1TrialProbe for StubProbe {
    async fn check(&self, _base_url: &str, _key: &str) -> Tier1TrialCheck {
        self.0.clone()
    }
}

fn engine_with(check: Tier1TrialCheck) -> Tier1TrialEngine {
    Tier1TrialEngine::with_probe(
        true,
        std::env::temp_dir(),
        Arc::new(StubProbe(check)),
    )
}

#[tokio::test]
async fn a_green_check_records_a_green_verdict_with_a_fresh_age() {
    let engine = engine_with(Tier1TrialCheck::Green);
    engine
        .run_trial("claude", "http://gw".into(), "sk-key".into())
        .await;

    let result = engine.result("claude").expect("a verdict was recorded");
    assert_eq!(result.verdict, Tier1TrialVerdict::Green);

    // Folds into a green fact whose age is small and non-negative.
    match result.to_fact(Utc::now()) {
        Tier1TrialFact::Green { age_seconds } => {
            assert!((0..=5).contains(&age_seconds), "fresh age, got {age_seconds}s");
        }
        other => panic!("expected a green fact, got {other:?}"),
    }
}

#[tokio::test]
async fn a_401_check_records_an_expired_verdict() {
    let engine = engine_with(Tier1TrialCheck::Expired);
    engine
        .run_trial("claude", "http://gw".into(), "sk-key".into())
        .await;

    let result = engine.result("claude").expect("a verdict was recorded");
    assert_eq!(result.verdict, Tier1TrialVerdict::Expired);
    assert_eq!(result.to_fact(Utc::now()), Tier1TrialFact::Expired);
}

#[tokio::test]
async fn an_inconclusive_check_records_nothing() {
    let engine = engine_with(Tier1TrialCheck::Inconclusive("gateway unreachable".into()));
    engine
        .run_trial("claude", "http://gw".into(), "sk-key".into())
        .await;
    assert!(
        engine.result("claude").is_none(),
        "an unreachable gateway says nothing about the credential"
    );
}

#[test]
fn the_flag_gates_the_engine() {
    let disabled = Tier1TrialEngine::with_probe(
        false,
        std::env::temp_dir(),
        Arc::new(StubProbe(Tier1TrialCheck::Green)),
    );
    assert!(!disabled.enabled());
    // A poke on a disabled engine records nothing and never touches the network.
    let disabled = Arc::new(disabled);
    disabled.poke("claude");
    assert!(disabled.result("claude").is_none());
}

// -- The real HTTP classification against a raw one-shot stub server. ---------

/// Serve exactly one HTTP request with the given status line + body, then close.
/// A raw socket rather than a framework: the surface under test is a single
/// `GET /v1/models`, and this keeps the stub dependency-free.
fn one_shot_server(status_line: &'static str, body: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let response = format!(
                "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn http_probe_maps_200_to_green() {
    let base_url = one_shot_server("HTTP/1.1 200 OK", "{\"data\":[]}");
    let check = HttpTier1TrialProbe.check(&base_url, "sk-key").await;
    assert_eq!(check, Tier1TrialCheck::Green);
}

#[tokio::test]
async fn http_probe_maps_401_to_expired() {
    let base_url = one_shot_server("HTTP/1.1 401 Unauthorized", "");
    let check = HttpTier1TrialProbe.check(&base_url, "sk-bad").await;
    assert_eq!(check, Tier1TrialCheck::Expired);
}
