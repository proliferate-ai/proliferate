//! `apply_state_file` under concurrent pushes: the read-diff-write must be
//! LINEARIZABLE, because the diff it returns is the changed set that targets
//! every downstream poke and status refresh.
//!
//! Without the state file's exclusive lock two concurrent PUTs both read the
//! same baseline, so the second's changed set is computed against a document
//! that is no longer on disk — and a harness the first push already moved is
//! silently omitted. An omitted harness launches with new auth while its status
//! document and its probe are never refreshed for it, which is strictly worse
//! than a spurious poke.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use super::*;
use crate::domains::agents::route_auth::test_support::TempHome;

/// Codex alternates method family with the sequence's parity, so the diff
/// between two adjacent documents is decidable from their sequences alone.
/// Grok never moves, so a document that reports grok changed can only be the
/// very first one.
fn document(sequence: i64) -> AgentAuthState {
    let codex_source = if sequence % 2 == 0 {
        serde_json::json!({ "kind": "gateway", "base_url": "https://gw.example", "key": "k" })
    } else {
        serde_json::json!({ "kind": "api_key", "env_var_name": "OPENAI_API_KEY", "value": "k" })
    };
    serde_json::from_value(serde_json::json!({
        "version": 2,
        "sequence": sequence,
        "harnesses": [
            { "harness_kind": "codex", "sources": [codex_source] },
            { "harness_kind": "grok", "sources": [
                { "kind": "api_key", "env_var_name": "XAI_API_KEY", "value": "x" }] },
        ],
    }))
    .expect("document")
}

/// What the diff MUST report for a push of `sequence` landing on top of
/// `previous` (`None` = the file was absent).
fn expected_changed(previous: Option<i64>, sequence: i64) -> Vec<String> {
    match previous {
        None => vec!["codex".to_string(), "grok".to_string()],
        Some(previous) if previous % 2 != sequence % 2 => vec!["codex".to_string()],
        Some(_) => Vec::new(),
    }
}

/// Every push that SUCCEEDS reports the diff against the document that was on
/// disk immediately before its own write — never against an older one.
///
/// The proof is a linearization: the sequence guard means a successful push
/// always carries a sequence above the file's, so ordering the successes by
/// sequence is exactly ordering them by write time. Each success's changed set
/// must therefore equal the diff against its immediate predecessor among the
/// successes. Against the unlocked read-diff-write, two threads that read the
/// same baseline both diff against it and one of them reports a changed set for
/// a document two steps back.
#[test]
fn concurrent_pushes_each_diff_against_their_own_immediate_predecessor() {
    let home = TempHome::new("apply-linearizable");
    let next_sequence = Arc::new(AtomicI64::new(1));
    #[allow(clippy::type_complexity)]
    let applied: Arc<Mutex<Vec<(i64, Vec<String>)>>> = Arc::new(Mutex::new(Vec::new()));

    let mut threads = Vec::new();
    for _ in 0..4 {
        let home_path = home.path().to_path_buf();
        let next_sequence = next_sequence.clone();
        let applied = applied.clone();
        threads.push(std::thread::spawn(move || {
            for _ in 0..60 {
                let sequence = next_sequence.fetch_add(1, Ordering::SeqCst);
                match apply_state_file(&home_path, &document(sequence)) {
                    Ok(outcome) => applied
                        .lock()
                        .expect("applied lock")
                        .push((sequence, outcome.changed_harnesses)),
                    // A push whose slot was overtaken is refused, which is the
                    // sequence guard doing its job — not a diff at all.
                    Err(RouteAuthError::StaleStateSequence { .. }) => {}
                    Err(error) => panic!("unexpected apply failure: {error:?}"),
                }
            }
        }));
    }
    for thread in threads {
        thread.join().expect("apply thread");
    }

    let mut applied = applied.lock().expect("applied lock").clone();
    applied.sort_by_key(|(sequence, _)| *sequence);
    assert!(
        applied.len() >= 2,
        "the race must have produced at least two successful pushes, got {}",
        applied.len()
    );
    let mut previous: Option<i64> = None;
    for (sequence, changed) in &applied {
        assert_eq!(
            changed,
            &expected_changed(previous, *sequence),
            "the push at sequence {sequence} reported {changed:?}, but the document \
             on disk immediately before it was {previous:?} — the diff was computed \
             against a baseline that had already been replaced"
        );
        previous = Some(*sequence);
    }
    // And the file that survives is the highest sequence that applied.
    let persisted = load_state_file(home.path())
        .expect("load")
        .expect("present");
    assert_eq!(
        persisted.sequence,
        applied.last().expect("a success").0,
        "the last write in sequence order is the one on disk"
    );
}
