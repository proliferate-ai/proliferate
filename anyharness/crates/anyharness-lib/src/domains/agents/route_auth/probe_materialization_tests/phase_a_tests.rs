//! T-30..T-31: phase A writes nothing, and phase B uses what phase A captured.

use super::super::*;
use super::*;

// ---------------------------------------------------------------------------
// T-30..T-31: phase A is read-only, and phase A/B agree
// ---------------------------------------------------------------------------

/// T-30 — **the assertion the two-phase split exists for.** Evaluating the gate
/// for all 17 (harness, context) pairs must leave the runtime home byte-identical:
/// no `agent-auth-probe/`, no `codex-home-*`, no `opencode.json`, no `*.tmp-*`.
///
/// A single-function seam would have failed this: it would have written a 0700
/// scratch plus a virtual-key-bearing config on every one of the 17 evaluations,
/// including the 17 "fresh, do nothing" answers of a startup pass.
#[test]
fn a_gate_evaluation_over_every_context_writes_nothing() {
    let home = TempHome::new("phase-a-readonly");
    home.write_state_json(&state(
        11,
        json!([
            { "harness_kind": "claude", "sources": [gateway_source(VK)] },
            { "harness_kind": "codex", "sources": [gateway_source(VK)] },
            { "harness_kind": "grok", "sources": [gateway_source(VK)] },
            {
                "harness_kind": "opencode",
                "sources": [
                    gateway_source(VK),
                    api_key_source("ANTHROPIC_API_KEY", "sk-ant"),
                    api_key_source("OPENAI_API_KEY", "sk-oai"),
                ],
            },
        ]),
    ));

    let before = tree_snapshot(home.path());
    let mut evaluated = 0;
    for (harness, contexts) in all_seventeen_contexts() {
        for context in &contexts {
            // Errors are legitimate answers here (an unsatisfiable context); what
            // matters is that neither answer writes.
            let _ = material_for(&home, harness, &context.id, &contexts);
            evaluated += 1;
        }
    }
    assert_eq!(evaluated, 17, "the shipped catalog declares 17 contexts");

    let after = tree_snapshot(home.path());
    assert_eq!(
        before, after,
        "phase A must not create, modify or remove anything under the runtime home"
    );
    assert!(
        !home.path().join("agent-auth-probe").exists(),
        "no scratch root may exist after gate evaluations"
    );
}

/// T-31 — phase B uses the revision phase A carried, and it uses the profile phase
/// A captured: mutating `state.json` between the two phases must not change what
/// gets materialized. One state read, one revision, three consumers.
#[test]
fn phase_b_uses_the_revision_and_profile_phase_a_captured() {
    let home = TempHome::new("phase-agreement");
    home.write_state_json(&state(
        7,
        json!([{ "harness_kind": "codex", "sources": [gateway_source(VK)] }]),
    ));
    let contexts = codex_contexts();

    let material = material_for(&home, "codex", "gateway", &contexts).expect("material");
    assert_eq!(material.state_revision, 7);

    // The document moves on — a different revision AND a different key — after the
    // gate decided.
    home.write_state_json(&state(
        99,
        json!([{ "harness_kind": "codex", "sources": [gateway_source("sk-rotated")] }]),
    ));

    let materialized = materialize_for_probe(home.path(), "codex", &material, &plan_with(&["m-1"]))
        .expect("materialize");

    assert!(
        materialized.scratch.root().join("agent-auth/codex-home-7").is_dir(),
        "the scratch dir must be keyed on the revision phase A read, not the current one"
    );
    assert!(
        !materialized.scratch.root().join("agent-auth/codex-home-99").exists(),
        "phase B must not re-read state.json"
    );
    assert_eq!(
        materialized.env_set.get("PROLIFERATE_GATEWAY_KEY").map(String::as_str),
        Some(VK),
        "phase B must materialize the credential the gate judged, not a newer one"
    );
}
