//! T-18, T-19: per-context fingerprint scoping, stability and sensitivity.

use super::*;

// ---------------------------------------------------------------------------
// T-18, T-19: fingerprint scoping, stability and sensitivity
// ---------------------------------------------------------------------------

fn contexts_for(id: &str) -> Vec<crate::domains::agents::catalog::schema::AgentCatalogAuthContext> {
    use crate::domains::agents::catalog::schema::{AgentCatalogAuthContext, AgentCatalogAuthSignal};
    vec![AgentCatalogAuthContext {
        id: id.to_string(),
        auth_slot_id: Some("gateway".to_string()),
        description: None,
        signals: Some(AgentCatalogAuthSignal::Route("gateway".to_string())),
    }]
}

fn state_json(revision: i64, harnesses: serde_json::Value) -> serde_json::Value {
    json!({ "version": 2, "revision": revision, "harnesses": harnesses })
}

fn gateway_harness(kind: &str, key: &str) -> serde_json::Value {
    json!({
        "harness_kind": kind,
        "sources": [{ "kind": "gateway", "base_url": "https://gw.example", "key": key }],
    })
}

fn fingerprint_of(home: &TempHome, harness: &str, context_id: &str) -> String {
    let material = probe_auth_material_for_server(
        home.path(),
        harness,
        context_id,
        &contexts_for(context_id),
        None,
    )
    .expect("material");
    fingerprint(&material)
}

/// T-18 — **the per-context scoping property.** Rotating ONE harness's key must
/// move only that harness's fingerprint. This fails under revision keying (the
/// global revision bumps for both) and passes under fingerprint keying.
#[test]
fn rotating_one_harnesss_key_leaves_the_other_harness_fresh() {
    let home = TempHome::new("fingerprint-scope");
    home.write_state_json(&state_json(
        4,
        json!([gateway_harness("claude", "sk-a"), gateway_harness("codex", "sk-b")]),
    ));
    let claude_before = fingerprint_of(&home, "claude", "gateway");
    let codex_before = fingerprint_of(&home, "codex", "gateway");

    // Rotate claude's key only. Note the revision ALSO bumps, exactly as the real
    // control plane would — which is what makes revision keying wrong.
    home.write_state_json(&state_json(
        5,
        json!([gateway_harness("claude", "sk-a-ROTATED"), gateway_harness("codex", "sk-b")]),
    ));
    let claude_after = fingerprint_of(&home, "claude", "gateway");
    let codex_after = fingerprint_of(&home, "codex", "gateway");

    assert_ne!(claude_before, claude_after, "the rotated harness must go stale");
    assert_eq!(
        codex_before, codex_after,
        "the untouched harness must stay fresh even though the global revision moved"
    );

    // And the gate agrees, not just the digests.
    let identity = identity(Some("1.0"), Some("sha"), "npm");
    let codex_entry = entry(HOUR, Some(identity.clone()), &codex_before);
    assert_eq!(
        evaluate(
            Some(&codex_entry),
            Some(&identity),
            &codex_after,
            now(),
            24 * HOUR
        ),
        Freshness::Fresh
    );
    let claude_entry = entry(HOUR, Some(identity.clone()), &claude_before);
    assert_eq!(
        evaluate(
            Some(&claude_entry),
            Some(&identity),
            &claude_after,
            now(),
            24 * HOUR
        ),
        Freshness::Stale(StaleReason::AuthMoved)
    );
}

/// T-19 — stability and sensitivity: identical material digests identically, and
/// each input that could change what a launch resolves to moves the digest.
#[test]
fn the_fingerprint_is_stable_and_sensitive_to_every_input() {
    let home = TempHome::new("fingerprint-sensitivity");
    home.write_state_json(&state_json(1, json!([gateway_harness("claude", "sk-1")])));

    let baseline = fingerprint_of(&home, "claude", "gateway");
    assert_eq!(
        baseline,
        fingerprint_of(&home, "claude", "gateway"),
        "identical material must digest identically"
    );
    assert!(baseline.starts_with("sha256:"));

    // The key.
    home.write_state_json(&state_json(1, json!([gateway_harness("claude", "sk-2")])));
    let key_changed = fingerprint_of(&home, "claude", "gateway");
    assert_ne!(baseline, key_changed);

    // The base URL.
    home.write_state_json(&state_json(
        1,
        json!([{
            "harness_kind": "claude",
            "sources": [{ "kind": "gateway", "base_url": "https://other.example", "key": "sk-1" }],
        }]),
    ));
    assert_ne!(baseline, fingerprint_of(&home, "claude", "gateway"));

    // Reordering equivalent env pairs must NOT change it (phase A sorts).
    let home = TempHome::new("fingerprint-order");
    let a_then_b = json!([{
        "harness_kind": "opencode",
        "sources": [
            { "kind": "api_key", "env_var_name": "A_KEY", "value": "1" },
            { "kind": "api_key", "env_var_name": "B_KEY", "value": "2" },
        ],
    }]);
    let b_then_a = json!([{
        "harness_kind": "opencode",
        "sources": [
            { "kind": "api_key", "env_var_name": "B_KEY", "value": "2" },
            { "kind": "api_key", "env_var_name": "A_KEY", "value": "1" },
        ],
    }]);
    let both_context = {
        use crate::domains::agents::catalog::schema::{
            AgentCatalogAuthContext, AgentCatalogAuthSignal,
        };
        vec![AgentCatalogAuthContext {
            id: "multi".to_string(),
            auth_slot_id: Some("anthropic".to_string()),
            description: None,
            signals: Some(AgentCatalogAuthSignal::AnyOf(vec![
                AgentCatalogAuthSignal::Env("A_KEY".into()),
                AgentCatalogAuthSignal::Env("B_KEY".into()),
            ])),
        }]
    };
    home.write_state_json(&state_json(1, a_then_b));
    let forward = fingerprint(
        &probe_auth_material_for_server(home.path(), "opencode", "multi", &both_context, None)
            .expect("material"),
    );
    home.write_state_json(&state_json(1, b_then_a));
    let reversed = fingerprint(
        &probe_auth_material_for_server(home.path(), "opencode", "multi", &both_context, None)
            .expect("material"),
    );
    assert_eq!(
        forward, reversed,
        "source order must not change the fingerprint"
    );
}
