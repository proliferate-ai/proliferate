//! ADVERSARIAL REVIEW TESTS (review-a worktree only — never for the branch).
//! Target: `changed_harnesses` canonicalization and completeness.

use super::state::*;
use crate::domains::agents::route_auth::test_support::TempHome;

fn doc(sequence: i64, origin: Option<&str>, settings: serde_json::Value) -> serde_json::Value {
    let mut entry = serde_json::json!({
        "harness_kind": "codex",
        "sources": [{ "kind": "gateway", "base_url": "https://gw.example", "key": "k" }],
    });
    if !settings.is_null() {
        entry["settings"] = settings;
    }
    let mut state = serde_json::json!({
        "version": 2,
        "sequence": sequence,
        "harnesses": [entry],
    });
    if let Some(origin) = origin {
        state["issuing_server_origin"] = serde_json::Value::String(origin.to_string());
    }
    state
}

fn apply(home: &TempHome, value: &serde_json::Value) -> Vec<String> {
    let state: AgentAuthState = serde_json::from_value(value.clone()).expect("parse state");
    apply_state_file(home.path(), &state)
        .expect("apply")
        .changed_harnesses
}

/// PROOF (holds): the `settings` rider is a `serde_json::Map`, and this crate
/// does not enable serde_json's `preserve_order`, so a push whose settings keys
/// arrive in a different JSON key order is NOT a change. Re-ordering the JSON
/// text must poke nothing.
#[test]
fn adversarial_settings_key_order_is_not_a_change() {
    let home = TempHome::new("adv-settings-order");
    assert_eq!(
        apply(
            &home,
            &doc(
                1,
                None,
                serde_json::json!({ "rotate": true, "zzz": 1, "aaa": 2 })
            )
        ),
        vec!["codex".to_string()],
        "the first apply against an absent file changes everything"
    );
    assert_eq!(
        apply(
            &home,
            &doc(
                2,
                None,
                serde_json::json!({ "aaa": 2, "rotate": true, "zzz": 1 })
            )
        ),
        Vec::<String>::new(),
        "re-ordered settings keys must not count as a change"
    );
    assert_eq!(
        apply(
            &home,
            &doc(
                3,
                None,
                serde_json::json!({ "aaa": 2, "rotate": false, "zzz": 1 })
            )
        ),
        vec!["codex".to_string()],
        "a real settings change must still count"
    );
}

/// ATTACK: the diff compares ONLY the per-harness entries, so a push that
/// changes the document-level `issuing_server_origin` while leaving every
/// harness entry byte-identical reports NO changed harness — no poke and no
/// status refresh.
///
/// That is a MISSED real change, not a spurious one: composition and launch
/// render both read the document through `load_effective_state`, which
/// DISCARDS a document stamped for a different server (treating it as absent).
/// So flipping the stamp flips every harness between "gateway routed" and
/// "native", and the status documents are never recomposed for it.
#[test]
fn adversarial_server_origin_flip_reports_no_changed_harness() {
    let home = TempHome::new("adv-origin-flip");
    assert_eq!(
        apply(&home, &doc(1, Some("https://a.example"), serde_json::Value::Null)),
        vec!["codex".to_string()]
    );
    let changed = apply(&home, &doc(2, Some("https://b.example"), serde_json::Value::Null));
    assert_eq!(
        changed,
        vec!["codex".to_string()],
        "flipping the issuing server origin flips every harness between routed \
         and native for composition and for launch render, so it MUST be a \
         changed harness; the diff reported {changed:?}"
    );
}

/// ATTACK: a duplicate `harness_kind` in the previous document whose extra
/// entry disappears is reported as no change at all.
#[test]
fn adversarial_dropped_duplicate_entry_reports_no_change() {
    let home = TempHome::new("adv-dup-entry");
    let two = serde_json::json!({
        "version": 2, "sequence": 1,
        "harnesses": [
            { "harness_kind": "codex", "sources": [
                { "kind": "gateway", "base_url": "https://gw.example", "key": "k" }] },
            { "harness_kind": "codex", "sources": [
                { "kind": "api_key", "env_var_name": "OPENAI_API_KEY", "value": "k2" }] },
        ],
    });
    apply(&home, &two);
    let one = serde_json::json!({
        "version": 2, "sequence": 2,
        "harnesses": [
            { "harness_kind": "codex", "sources": [
                { "kind": "gateway", "base_url": "https://gw.example", "key": "k" }] },
        ],
    });
    assert_eq!(
        apply(&home, &one),
        Vec::<String>::new(),
        "documented for the record: dropping a duplicate entry is invisible to \
         the diff (benign only because every reader also uses first-match)"
    );
}
