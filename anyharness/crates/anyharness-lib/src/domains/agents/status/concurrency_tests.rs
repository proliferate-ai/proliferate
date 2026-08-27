//! Concurrency pins for the status store's lock/transaction discipline under
//! concurrent pokes. Born in an adversarial review; kept on the branch because
//! the races they pin are permanent invariants, not review scaffolding.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{TimeZone, Utc};

use super::{parse_doc, AgentStatusService, RefreshCause};
use crate::domains::agents::launch_probe::test_support::FixedTargets;
use crate::domains::agents::route_auth::test_support::TempHome;
use crate::persistence::Db;

fn service(home: &TempHome, targets: FixedTargets) -> AgentStatusService {
    AgentStatusService::with_parts(
        Db::open(home.path()).expect("open db"),
        home.path().to_path_buf(),
        Arc::new(targets),
        vec!["codex".to_string(), "grok".to_string()],
        home.path().join("detection-home"),
    )
}

fn codex_gateway_state(sequence: i64) -> serde_json::Value {
    serde_json::json!({
        "version": 2,
        "sequence": sequence,
        "harnesses": [
            { "harness_kind": "codex", "sources": [
                { "kind": "gateway", "base_url": "https://gw.example", "key": "k" }] },
        ],
    })
}

/// INVARIANT I1 (serial): the persisted document's probe block and the
/// persisted OBSERVATION columns always agree — every writer either carries
/// the observation forward verbatim (`Keep`) or writes both together (`Set`).
/// Proven serially first so that a concurrent violation below cannot be waved
/// off as "the invariant never held".
#[test]
fn adversarial_doc_and_observation_agree_serially() {
    let home = TempHome::new("adv-serial-agree");
    home.write_state_json(&codex_gateway_state(1));
    let service = service(&home, FixedTargets::single("codex"));
    service.refresh("codex", RefreshCause::AuthApplied);

    let check = |label: &str| {
        let row = service.store.read("codex").expect("row");
        let doc = service.read("codex").expect("doc");
        assert_eq!(
            doc.probe.at, row.probe_at,
            "{label}: doc probe.at must equal the stored observation"
        );
    };

    service.probe_admitted("codex");
    check("after admission");
    service.probe_failed(
        "codex",
        Utc.with_ymd_and_hms(2026, 8, 27, 10, 0, 0).unwrap(),
    );
    check("after first failure");
    service.probe_admitted("codex");
    check("after re-admission");
    service.probe_verified(
        "codex",
        Utc.with_ymd_and_hms(2026, 8, 27, 11, 0, 0).unwrap(),
    );
    check("after success");
    service.probe_admitted("codex");
    check("after admission over a success");
    service.probe_failed(
        "codex",
        Utc.with_ymd_and_hms(2026, 8, 27, 12, 0, 0).unwrap(),
    );
    check("after a failure over a success");
    service.refresh("codex", RefreshCause::LoginTerminal);
    check("after a plain refresh");
}

/// ATTACK: `AgentStatusService::persist` is a non-transactional
/// read-modify-write (`store.read` for the byte-stability gate, then
/// `store.upsert`), and `compose` does real file I/O between the read of the
/// stored probe block and the write. `probe_admitted` (an
/// `ObservationWrite::Keep` writer) therefore races `probe_verified` (a `Set`
/// writer) — and these two are genuinely concurrent in production, because
/// `probe_on_event` calls `notify_probe_admitted` BEFORE it queues on the
/// single-flight gate, while a previous attempt is still inside `run_attempt`.
#[test]
fn adversarial_concurrent_admit_and_verify_tear_doc_from_observation() {
    let home = TempHome::new("adv-tear-doc-observation");
    home.write_state_json(&codex_gateway_state(1));
    let service = Arc::new(service(&home, FixedTargets::single("codex")));
    service.refresh("codex", RefreshCause::AuthApplied);
    service.probe_verified("codex", Utc.with_ymd_and_hms(2026, 8, 27, 9, 0, 0).unwrap());

    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let torn = Arc::new(Mutex::new(Vec::<String>::new()));

    let verifier = {
        let service = service.clone();
        let stop = stop.clone();
        std::thread::spawn(move || {
            for i in 0..800i64 {
                let at = Utc.with_ymd_and_hms(2026, 8, 27, 10, 0, 0).unwrap()
                    + chrono::Duration::seconds(i);
                service.probe_verified("codex", at);
            }
            stop.store(true, Ordering::Relaxed);
        })
    };
    let admitter = {
        let service = service.clone();
        let stop = stop.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                service.probe_admitted("codex");
            }
        })
    };
    // The monitor's read is ONE `query_row` over the single shared connection,
    // so any divergence it sees is a genuinely persisted torn row, never a
    // half-read.
    let monitor = {
        let service = service.clone();
        let stop = stop.clone();
        let torn = torn.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                if let Some(row) = service.store.read("codex") {
                    if let Some(doc) = parse_doc("codex", &row.doc_json) {
                        if doc.probe.at != row.probe_at {
                            torn.lock().expect("torn lock").push(format!(
                                "doc: verdict={:?} at={:?} stale={} || observation: verdict={:?} at={:?}",
                                doc.probe.verdict,
                                doc.probe.at,
                                doc.probe.stale,
                                row.probe_verdict,
                                row.probe_at
                            ));
                        }
                    }
                }
            }
        })
    };
    verifier.join().expect("verifier");
    admitter.join().expect("admitter");
    monitor.join().expect("monitor");

    let torn = torn.lock().expect("torn lock").clone();
    assert!(
        torn.is_empty(),
        "the persisted document and the persisted observation diverged ({} sightings); first: {}",
        torn.len(),
        torn.first().map(String::as_str).unwrap_or("")
    );
}

/// ATTACK (the other half of the same race): a composition refresh
/// (`RefreshCause::AuthApplied`) racing `probe_verified` can lose the AUTH
/// change from the served document — the PUT handler spawns the poke and then
/// calls `refresh_harnesses` on the same tick, so both writers are live for the
/// same harness. A probe writer that COMPOSES writes whatever `state.json` said
/// when IT read the file, which can be an auth world that was already gone.
///
/// INVARIANT I3: the served document's auth world is one the state file
/// genuinely held at some instant DURING the refresh that wrote it. Serving an
/// older one is a lost auth change: launches route by the new world while the
/// pane, the method picker and the launch-options basis all read the old one.
///
/// Two deliberate corrections to the review's harness, both about measuring I3
/// rather than about the property (each one was diagnosed from the residual
/// failures it produced, never assumed):
///
/// 1. the flipper writes the way PRODUCTION writes — temp file plus rename.
///    `write_private_file` is the ONLY writer state.json ever has, so a
///    zero-length in-place truncation is not a state the runtime can observe;
///    a raw `fs::write` made both bracket reads intermittently parse as "no
///    state at all", which counted as a regression against a document that was
///    perfectly correct.
/// 2. a regression is the served world matching NO world the file held during
///    the refresh — not merely neither of two point samples. This flipper
///    rewrites the file thousands of times per second, so it can flip TWICE
///    inside one refresh, and a document composed from the world in between is
///    exactly right while matching neither sample. The flipper therefore
///    records what it published and when, and the check asks the real question.
#[test]
fn adversarial_concurrent_refresh_and_verify_can_lose_the_auth_change() {
    let home = TempHome::new("adv-lose-auth-change");
    home.write_state_json(&codex_gateway_state(1));
    let service = Arc::new(service(&home, FixedTargets::single("codex")));
    service.refresh("codex", RefreshCause::AuthApplied);

    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let regressions = Arc::new(AtomicU32::new(0));
    // (published_at, method kind) for every world the flipper made visible.
    let published = Arc::new(Mutex::new(Vec::<(std::time::Instant, String)>::new()));

    let applied_kind_in_file = |home_path: &std::path::Path| -> Option<String> {
        crate::domains::agents::route_auth::load_state_file(home_path)
            .ok()
            .flatten()
            .and_then(|state| {
                state
                    .harnesses
                    .iter()
                    .find(|entry| entry.harness_kind == "codex")
                    .and_then(|entry| entry.sources.first().map(|source| source.kind.clone()))
            })
    };

    // The auth world flips codex between `gateway` and `api_key` (a real method
    // switch — the only auth movement the document's shape reflects).
    let flipper = {
        let home_path = home.path().to_path_buf();
        let published = published.clone();
        std::thread::spawn(move || {
            for i in 0..1_200u32 {
                let kind = if i % 2 == 0 { "gateway" } else { "api_key" };
                let sources = if i % 2 == 0 {
                    serde_json::json!([
                        { "kind": "gateway", "base_url": "https://gw.example", "key": "k" }])
                } else {
                    serde_json::json!([
                        { "kind": "api_key", "env_var_name": "OPENAI_API_KEY", "value": "k" }])
                };
                let doc = serde_json::json!({
                    "version": 2, "sequence": 10 + i,
                    "harnesses": [{ "harness_kind": "codex", "sources": sources }],
                });
                let path = crate::domains::agents::route_auth::state_file_path(&home_path);
                let staged = path.with_extension(format!("tmp-{i}"));
                std::fs::write(&staged, serde_json::to_vec(&doc).expect("serialize"))
                    .expect("stage state");
                std::fs::rename(&staged, &path).expect("publish state");
                published
                    .lock()
                    .expect("published lock")
                    .push((std::time::Instant::now(), kind.to_string()));
            }
        })
    };
    let prober = {
        let service = service.clone();
        let stop = stop.clone();
        std::thread::spawn(move || {
            let mut i = 0i64;
            while !stop.load(Ordering::Relaxed) {
                service.probe_verified(
                    "codex",
                    Utc.with_ymd_and_hms(2026, 8, 27, 10, 0, 0).unwrap()
                        + chrono::Duration::seconds(i),
                );
                i += 1;
            }
        })
    };
    let refresher = {
        let service = service.clone();
        let stop = stop.clone();
        let regressions = regressions.clone();
        let published = published.clone();
        let home_path = home.path().to_path_buf();
        std::thread::spawn(move || {
            for _ in 0..3_000u32 {
                // `opened` precedes the baseline READ, not just the refresh: a
                // publish landing while that read is in flight must fall inside
                // the recorded window, or the world it made visible would be
                // attributable to nothing.
                let opened = std::time::Instant::now();
                let before = applied_kind_in_file(&home_path);
                service.refresh("codex", RefreshCause::AuthApplied);
                let closed = std::time::Instant::now();
                let after = applied_kind_in_file(&home_path);
                let served = service
                    .read("codex")
                    .and_then(|doc| doc.applied.map(|applied| applied.kind));
                if let Some(served) = served {
                    if Some(served.clone()) != before && Some(served.clone()) != after {
                        // Exhaustive by construction: let P be the last publish
                        // at or before the refresh's own read of the file. Either
                        // P >= `opened`, and P is in the window below; or
                        // P < `opened`, in which case the world never moved
                        // between P and the read, so it is `before`'s world.
                        // Anything else is a world the file never held here.
                        let held_during_refresh = published
                            .lock()
                            .expect("published lock")
                            .iter()
                            .any(|(at, kind)| *at >= opened && *at <= closed && *kind == served);
                        if !held_during_refresh {
                            regressions.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
            }
            stop.store(true, Ordering::Relaxed);
        })
    };
    flipper.join().expect("flipper");
    prober.join().expect("prober");
    refresher.join().expect("refresher");

    assert_eq!(
        regressions.load(Ordering::Relaxed),
        0,
        "a concurrent probe write reverted the served document to an auth world \
         that the state file held at no point during the refresh"
    );
}
