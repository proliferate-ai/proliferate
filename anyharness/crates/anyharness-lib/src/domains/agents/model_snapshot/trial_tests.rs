//! Tier-1 trial: verdict mapping (green with age / expired on 401), the flag
//! gate, credential-fingerprinted invalidation (source switch clears a stale
//! verdict; a rotated key drops the old green), and single-flight (coalescing
//! plus panic self-heal). Proven against stubbed check seams and a raw local
//! HTTP stub for the gateway admin surface (no live network, no mock-LLM).

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use chrono::Utc;

use super::super::test_support::{gateway_state, TempRuntimeHome};
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

/// Green for one key, inconclusive for any other — the shape a key rotation sees.
struct KeyedProbe {
    green_key: String,
}

#[async_trait::async_trait]
impl Tier1TrialProbe for KeyedProbe {
    async fn check(&self, _base_url: &str, key: &str) -> Tier1TrialCheck {
        if key == self.green_key {
            Tier1TrialCheck::Green
        } else {
            Tier1TrialCheck::Inconclusive("rotated key not accepted here".into())
        }
    }
}

/// Counts checks and answers green, for the single-flight coalescing assertion.
struct CountingProbe {
    checks: AtomicUsize,
}

#[async_trait::async_trait]
impl Tier1TrialProbe for CountingProbe {
    async fn check(&self, _base_url: &str, _key: &str) -> Tier1TrialCheck {
        self.checks.fetch_add(1, Ordering::SeqCst);
        Tier1TrialCheck::Green
    }
}

/// Panics on its first check, then answers green — proves the in-flight slot is
/// freed even when a trial task unwinds.
struct PanicOnceProbe {
    checks: AtomicUsize,
}

#[async_trait::async_trait]
impl Tier1TrialProbe for PanicOnceProbe {
    async fn check(&self, _base_url: &str, _key: &str) -> Tier1TrialCheck {
        if self.checks.fetch_add(1, Ordering::SeqCst) == 0 {
            panic!("trial task blew up mid-check");
        }
        Tier1TrialCheck::Green
    }
}

fn unique_home() -> PathBuf {
    std::env::temp_dir().join(format!("anyharness-trial-{}", uuid::Uuid::new_v4()))
}

fn engine_with(check: Tier1TrialCheck) -> Tier1TrialEngine {
    Tier1TrialEngine::with_probe(true, unique_home(), Arc::new(StubProbe(check)))
}

/// Poll until `predicate` holds or a short real-time budget elapses. Trials run
/// on spawned tasks, so a test observes their effect by waiting, not by joining.
async fn wait_until(mut predicate: impl FnMut() -> bool) {
    for _ in 0..200 {
        if predicate() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    panic!("condition not reached within the trial test budget");
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

#[tokio::test]
async fn poking_without_a_gateway_source_clears_a_stale_verdict() {
    // A green verdict is on the books...
    let engine = Arc::new(engine_with(Tier1TrialCheck::Green));
    engine
        .run_trial("claude", "https://gw".into(), "sk-key".into())
        .await;
    assert!(engine.result("claude").is_some());

    // ...but the harness's (unique, empty) home has no gateway source, so a poke
    // clears it rather than leaving a verdict about a credential that is gone.
    engine.poke("claude");
    assert!(
        engine.result("claude").is_none(),
        "a source switch away from the gateway must clear the stale verdict"
    );
}

#[tokio::test]
async fn a_rotated_key_then_inconclusive_recheck_drops_the_stale_green() {
    let engine = Arc::new(Tier1TrialEngine::with_probe(
        true,
        unique_home(),
        Arc::new(KeyedProbe {
            green_key: "key-a".into(),
        }),
    ));

    // Key A checks green.
    engine
        .run_trial("claude", "https://gw".into(), "key-a".into())
        .await;
    let green = engine.result("claude").expect("green on key A");
    assert_eq!(green.verdict, Tier1TrialVerdict::Green);
    let fingerprint_a = engine.result_fingerprint("claude").expect("fingerprint A");

    // Key rotates to B; the recheck is inconclusive. The old green was about key
    // A, so it must NOT survive the rotation.
    engine
        .run_trial("claude", "https://gw".into(), "key-b".into())
        .await;
    assert!(
        engine.result("claude").is_none(),
        "a rotated key plus an inconclusive recheck must not keep the old green"
    );

    // And a fresh green on key B carries a DIFFERENT fingerprint than key A did.
    let engine_b = Arc::new(Tier1TrialEngine::with_probe(
        true,
        unique_home(),
        Arc::new(KeyedProbe {
            green_key: "key-b".into(),
        }),
    ));
    engine_b
        .run_trial("claude", "https://gw".into(), "key-b".into())
        .await;
    let fingerprint_b = engine_b.result_fingerprint("claude").expect("fingerprint B");
    assert_ne!(
        fingerprint_a, fingerprint_b,
        "a different key must fingerprint differently"
    );
}

#[tokio::test]
async fn concurrent_pokes_coalesce_to_one_check() {
    let home = TempRuntimeHome::new("trial-single");
    home.write_state_json(&gateway_state(1, &[("claude", "key-a")]));
    let probe = Arc::new(CountingProbe {
        checks: AtomicUsize::new(0),
    });
    let engine = Arc::new(Tier1TrialEngine::with_probe(
        true,
        home.path().to_path_buf(),
        probe.clone(),
    ));

    // Two synchronous pokes: the first inserts the in-flight slot and spawns; the
    // second sees the slot taken and no-ops, all before either task is polled.
    engine.poke("claude");
    engine.poke("claude");

    wait_until(|| engine.result("claude").is_some()).await;
    // Let any erroneously-spawned second task run before counting.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    assert_eq!(
        probe.checks.load(Ordering::SeqCst),
        1,
        "concurrent pokes for one harness must coalesce to a single check"
    );
}

#[tokio::test]
async fn a_panicking_trial_frees_its_single_flight_slot() {
    let home = TempRuntimeHome::new("trial-panic");
    home.write_state_json(&gateway_state(1, &[("claude", "key-a")]));
    let probe = Arc::new(PanicOnceProbe {
        checks: AtomicUsize::new(0),
    });
    let engine = Arc::new(Tier1TrialEngine::with_probe(
        true,
        home.path().to_path_buf(),
        probe.clone(),
    ));

    // First poke: the task panics mid-check. The in-flight guard must still free
    // the slot as the task unwinds.
    engine.poke("claude");
    wait_until(|| probe.checks.load(Ordering::SeqCst) >= 1).await;
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    assert!(
        engine.result("claude").is_none(),
        "a panicking trial records nothing"
    );

    // Second poke: it must be admitted (the slot self-healed) and record green.
    engine.poke("claude");
    wait_until(|| engine.result("claude").is_some()).await;
    assert_eq!(
        engine.result("claude").expect("green").verdict,
        Tier1TrialVerdict::Green,
        "the slot must self-heal so a later poke can run"
    );
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
