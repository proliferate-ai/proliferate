//! Phase A writes nothing, and phase B uses what phase A captured.

use super::*;

/// **The assertion the two-phase split exists for.** Reading the material for
/// every harness must leave the runtime home byte-identical: no
/// `agent-auth-probe/`, no `codex-home-*`, no `opencode.json`, no `*.tmp-*`.
///
/// A single-function seam would have failed this: it would have written a 0700
/// scratch plus a virtual-key-bearing config on every state read.
#[test]
fn a_material_read_over_every_harness_writes_nothing() {
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
    for harness in ["claude", "codex", "cursor", "grok", "opencode"] {
        // Errors are legitimate answers here; what matters is that neither
        // answer writes.
        let _ = material_for(&home, harness);
    }

    let after = tree_snapshot(home.path());
    assert_eq!(
        before, after,
        "the material read must not create, modify or remove anything under the runtime home"
    );
    assert!(
        !home.path().join("agent-auth-probe").exists(),
        "no scratch root may exist after material reads"
    );
}

/// Phase B uses the sequence phase A carried, and it uses the profile phase A
/// captured: mutating `state.json` between the two phases must not change what
/// gets materialized. One state read, one sequence, all consumers.
#[test]
fn phase_b_uses_the_sequence_and_profile_phase_a_captured() {
    let home = TempHome::new("phase-agreement");
    home.write_state_json(&state(
        7,
        json!([{ "harness_kind": "codex", "sources": [gateway_source(VK)] }]),
    ));

    let material = material_for(&home, "codex").expect("material");
    assert_eq!(material.state_sequence, 7);

    // The document moves on — a different sequence AND a different key — after
    // phase A read it.
    home.write_state_json(&state(
        99,
        json!([{ "harness_kind": "codex", "sources": [gateway_source("sk-rotated")] }]),
    ));

    let materialized = materialize_for_probe(home.path(), "codex", &material, &plan_with(&["m-1"]))
        .expect("materialize");

    assert!(
        materialized
            .scratch
            .root()
            .join("agent-auth/codex-home-7")
            .is_dir(),
        "the scratch dir must be keyed on the sequence phase A read, not the current one"
    );
    assert!(
        !materialized
            .scratch
            .root()
            .join("agent-auth/codex-home-99")
            .exists(),
        "phase B must not re-read state.json"
    );
    assert_eq!(
        materialized
            .env_set
            .get("PROLIFERATE_GATEWAY_KEY")
            .map(String::as_str),
        Some(VK),
        "phase B must materialize the credential phase A captured, not a newer one"
    );
}
