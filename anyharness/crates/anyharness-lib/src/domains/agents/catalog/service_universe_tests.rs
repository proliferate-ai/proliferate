//! Launch validation against the machine's observed universe.
//!
//! The same real draft catalog the rest of the read-surface suite pins, so every
//! assertion is against ids that genuinely ship. Pure: no runtime, no probe engine,
//! no filesystem — the universe arrives as data.
//!
//! The properties, in the order they matter:
//!
//! 1. an EMPTY universe reproduces today's answers exactly (the safety net every
//!    pre-probe machine and every machineless surface depends on);
//! 2. an observation makes a catalog model launchable under a context the catalog
//!    has not caught up to;
//! 3. an observation makes an entirely UNCATALOGUED model launchable — the case
//!    that lets a gateway-side model add work the day it appears;
//! 4. garbage is still rejected, with the same error kinds and shapes.

use std::sync::Arc;

use super::loader::parse_agent_catalog_json;
use super::schema::draft_catalog_json;
use super::service::{ActiveCatalog, SelectionUnsupported};
use super::universe::ObservedUniverse;
use crate::domains::agents::auth::context::ActiveAuthContexts;

fn draft_catalog() -> ActiveCatalog {
    let document = parse_agent_catalog_json(draft_catalog_json()).expect("draft must load");
    ActiveCatalog::new(Arc::new(document))
}

fn contexts(ids: &[&str]) -> ActiveAuthContexts {
    ActiveAuthContexts::test_from_ids(ids.iter().copied())
}

fn observed(pairs: &[(&str, &[&str])]) -> ObservedUniverse {
    ObservedUniverse::from_observations(
        pairs
            .iter()
            .map(|(context, ids)| ((*context).to_string(), ids.to_vec()))
            .collect::<Vec<_>>(),
    )
}

/// **The safety net.** With no observation, the universe-aware entry point and the
/// plain one must agree on every answer — accept, gate, and unknown alike.
///
/// This is what makes the change safe to land before the picker projection exists: a
/// machine that has never probed, and every surface with no runtime attached, validate
/// exactly as they did before.
#[test]
fn an_empty_universe_reproduces_the_pre_probe_answers_exactly() {
    let catalog = draft_catalog();
    let empty = ObservedUniverse::empty();

    let cases: &[(&str, &[&str], Option<&str>)] = &[
        ("claude", &["anthropic-oauth"], Some("opus")),
        ("claude", &["anthropic-oauth"], None),
        ("claude", &["bedrock"], Some("us.anthropic.claude-opus-4-8")),
        // Gated: a bare id under bedrock.
        ("claude", &["bedrock"], Some("sonnet")),
        // Unknown.
        ("claude", &["anthropic-api"], Some("nope")),
        ("codex", &["openai-api"], Some("gpt-5.5")),
        // Variant composition.
        ("codex", &["openai-api"], Some("gpt-5.5/high")),
        ("not-an-agent", &["baseline"], None),
    ];

    for (kind, context_ids, model_id) in cases {
        let active = contexts(context_ids);
        assert_eq!(
            catalog.validate_launch(kind, &active, *model_id, None),
            catalog.validate_launch_in_universe(kind, &active, *model_id, None, &empty),
            "the empty universe must not change ({kind}, {context_ids:?}, {model_id:?})"
        );
    }
}

/// An observation makes a catalog model available under a context whose
/// `availability.anyOf` does not list it.
///
/// This is the gap being closed, stated as behavior: `claude-opus-4-8` ships as
/// `anthropic-api`/`anthropic-oauth` only, so a gateway-routed launch of it is rejected
/// today even when the proxy serves it. Once the machine has observed it under
/// `gateway`, the launch succeeds — no catalog release required.
#[test]
fn an_observation_unlocks_a_catalog_model_the_catalog_gates() {
    let catalog = draft_catalog();
    let active = contexts(&["gateway"]);

    let gated = catalog
        .validate_launch("claude", &active, Some("claude-opus-4-8"), None)
        .expect_err("the shipped catalog does not serve this model over the gateway");
    assert!(matches!(gated, SelectionUnsupported::ModelGated { .. }));

    let universe = observed(&[("gateway", &["claude-opus-4-8", "claude-sonnet-4-5"])]);
    let selection = catalog
        .validate_launch_in_universe("claude", &active, Some("claude-opus-4-8"), None, &universe)
        .expect("the machine observed this model under the active gateway context");
    assert_eq!(selection.model_id.as_deref(), Some("claude-opus-4-8"));
    assert_eq!(selection.launch_model_id.as_deref(), Some("claude-opus-4-8"));
}

/// A model the shipped catalog has never heard of, observed under an active context,
/// launches — and keeps its observed id as its identity.
///
/// The catalog is a nightly probe's output, so a model the gateway or provider added
/// since is genuinely launchable and genuinely absent from it. The canonical id is the
/// observed id rather than a normalized guess: there is no catalog row to normalize to,
/// and inventing a match is the guessy name matching the enrichment join avoids.
#[test]
fn an_observed_but_uncatalogued_model_is_launchable_under_its_own_id() {
    let catalog = draft_catalog();
    let active = contexts(&["gateway"]);
    let brand_new = "claude-opus-5-20260901";

    assert!(matches!(
        catalog
            .validate_launch("claude", &active, Some(brand_new), None)
            .expect_err("absent from the shipped catalog"),
        SelectionUnsupported::UnknownModel { .. }
    ));

    let universe = observed(&[("gateway", &[brand_new])]);
    let selection = catalog
        .validate_launch_in_universe("claude", &active, Some(brand_new), None, &universe)
        .expect("observed under an active context");
    assert_eq!(selection.model_id.as_deref(), Some(brand_new));
    assert_eq!(selection.launch_model_id.as_deref(), Some(brand_new));
}

/// An uncatalogued model observed only under an INACTIVE context is `ModelGated`, not
/// `UnknownModel` — and `required_contexts` names the context that observed it.
///
/// The distinction is the whole value of the two error kinds: the client can unlock a
/// gated model by satisfying a named context, where an unknown one is unactionable.
#[test]
fn an_uncatalogued_model_observed_elsewhere_is_gated_not_unknown() {
    let catalog = draft_catalog();
    let brand_new = "claude-opus-5-20260901";
    let universe = observed(&[("gateway", &[brand_new])]);

    let error = catalog
        .validate_launch_in_universe(
            "claude",
            &contexts(&["anthropic-api"]),
            Some(brand_new),
            None,
            &universe,
        )
        .expect_err("observed, but not under an active context");
    match error {
        SelectionUnsupported::ModelGated {
            requested_model_id,
            canonical_model_id,
            active_contexts,
            required_contexts,
            ..
        } => {
            assert_eq!(requested_model_id, brand_new);
            assert_eq!(canonical_model_id, brand_new);
            assert_eq!(active_contexts, vec!["anthropic-api"]);
            assert_eq!(
                required_contexts,
                vec!["gateway"],
                "the unlock condition is the context that actually observed it"
            );
        }
        other => panic!("expected ModelGated, got {other:?}"),
    }
}

/// **Garbage is still garbage.** An id nothing observed and the catalog does not carry
/// is `UnknownModel`, whatever else the universe holds.
#[test]
fn garbage_is_rejected_even_with_a_rich_universe() {
    let catalog = draft_catalog();
    let universe = observed(&[
        ("gateway", &["claude-sonnet-4-5", "claude-opus-4-6"]),
        ("anthropic-api", &["sonnet", "haiku"]),
    ]);

    for garbage in [
        "definitely-not-a-model",
        "",
        "   ",
        "claude-sonnet-4-5-but-wrong",
        "../../etc/passwd",
    ] {
        let result = catalog.validate_launch_in_universe(
            "claude",
            &contexts(&["gateway"]),
            Some(garbage),
            None,
            &universe,
        );
        match result {
            // An empty/whitespace request is "no selection", which legitimately
            // resolves to a default rather than a rejection — the pre-existing rule.
            Ok(selection) => assert!(
                garbage.trim().is_empty(),
                "only a blank request may resolve to a default, got {selection:?} for {garbage:?}"
            ),
            Err(SelectionUnsupported::UnknownModel { model_id }) => {
                assert_eq!(model_id, garbage)
            }
            Err(other) => panic!("expected UnknownModel for {garbage:?}, got {other:?}"),
        }
    }
}

/// An observation NEVER narrows availability.
///
/// This is the direction the design has to get right, and real data forces it:
/// claude's own `anthropic-api` probe advertises four selectors (`default`, `sonnet`,
/// `haiku`, `opus[1m]`) while the shipped catalog additionally carries
/// `claude-fable-5` and `claude-opus-4-8` for that same context — trial-verified rows,
/// i.e. models the harness does not list but does launch. A per-context override would
/// refuse a launch that works today, so the union is mandatory rather than lenient.
#[test]
fn an_observation_never_removes_a_launchable_catalog_model() {
    let catalog = draft_catalog();
    let active = contexts(&["anthropic-api"]);
    // Exactly what claude.anthropic-api.probe.json advertises.
    let universe = observed(&[("anthropic-api", &["default", "opus[1m]", "sonnet", "haiku"])]);

    for still_launchable in ["claude-fable-5", "claude-opus-4-8"] {
        let selection = catalog
            .validate_launch_in_universe(
                "claude",
                &active,
                Some(still_launchable),
                None,
                &universe,
            )
            .unwrap_or_else(|error| {
                panic!("{still_launchable} must stay launchable, got {error:?}")
            });
        assert_eq!(selection.model_id.as_deref(), Some(still_launchable));
    }
}

/// A model observed only under a variant id stays launchable by its BASE id.
///
/// cursor advertises nothing else — every observed id is a composed
/// `base[k=v,...]` form — so matching on the bare id alone would make an observation
/// silently unavailable every cursor model, i.e. the probe would take capability away.
#[test]
fn a_variant_only_observation_keeps_the_base_model_available() {
    let catalog = draft_catalog();
    let active = contexts(&["cursor-login"]);
    // The real shape from cursor.cursor-login.probe.json.
    let universe = observed(&[(
        "cursor-login",
        &[
            "default[]",
            "grok-4.5[effort=high,fast=true]",
            "composer-2.5[fast=true]",
        ],
    )]);

    let selection = catalog
        .validate_launch_in_universe("cursor", &active, Some("grok-4.5"), None, &universe)
        .expect("the base model of an observed variant must stay launchable");
    assert_eq!(selection.model_id.as_deref(), Some("grok-4.5"));

    // And the composed form still resolves to the same base model.
    let composed = catalog
        .validate_launch_in_universe(
            "cursor",
            &active,
            Some("grok-4.5[effort=high,fast=true]"),
            None,
            &universe,
        )
        .expect("the observed variant id resolves through provenance");
    assert_eq!(composed.model_id.as_deref(), Some("grok-4.5"));
}

/// Mode validation is untouched by the universe: the ladder is catalog-authoritative
/// (control wiring is curation a probe cannot invent), and an uncatalogued model falls
/// through to the agent-level vocabulary.
#[test]
fn mode_validation_stays_catalog_authoritative() {
    let catalog = draft_catalog();
    let active = contexts(&["gateway"]);
    let brand_new = "claude-opus-5-20260901";
    let universe = observed(&[("gateway", &[brand_new])]);

    // A mode the agent declares is accepted for an uncatalogued model.
    let ok = catalog
        .validate_launch_in_universe("claude", &active, Some(brand_new), Some("plan"), &universe)
        .expect("an agent-level mode applies to an observed-only model");
    assert_eq!(ok.mode_id.as_deref(), Some("plan"));

    // An invented one is not, even though the model itself was observed.
    let error = catalog
        .validate_launch_in_universe(
            "claude",
            &active,
            Some(brand_new),
            Some("not-a-mode"),
            &universe,
        )
        .expect_err("an observation says nothing about mode vocabulary");
    assert!(matches!(
        error,
        SelectionUnsupported::UnsupportedMode { .. }
    ));
}

/// A default selection (no requested model) may come from the observation.
///
/// The curated default is consulted first and wins whenever it is available, so this
/// only fires when the catalog's default is NOT serveable under the active contexts —
/// exactly the pre-probe fallback rung, now able to see observed capability.
#[test]
fn a_default_selection_can_be_unlocked_by_an_observation() {
    let catalog = draft_catalog();
    // Under gateway alone, claude's curated default is `claude-sonnet-4-5`.
    let active = contexts(&["gateway"]);
    let universe = observed(&[("gateway", &["claude-opus-4-8"])]);

    let selection = catalog
        .validate_launch_in_universe("claude", &active, None, None, &universe)
        .expect("a default resolves");
    assert_eq!(
        selection.model_id.as_deref(),
        Some("claude-sonnet-4-5"),
        "the curated default still wins when it is available"
    );
    let _ = universe;
}
