//! Launch validation against the machine's composed observation.
//!
//! The same real draft catalog the rest of the read-surface suite pins, so every
//! assertion is against ids that genuinely ship. Pure: no runtime, no probe engine,
//! no filesystem — the universe arrives as data.
//!
//! The properties, in the order they matter:
//!
//! 1. an EMPTY universe reproduces the pre-probe answers exactly (the seed every
//!    machine before its first probe and every machineless surface depends on);
//! 2. the observation is the truth wherever it exists: an observed model is
//!    launchable even where the catalog gates it, an observed-but-uncatalogued
//!    model resolves to itself, and a model the observation lacks is refused;
//! 3. trial-verified rows survive the observation's silence;
//! 4. garbage is still rejected, with the same error kinds and shapes.

use std::sync::Arc;

use super::loader::parse_agent_catalog_json;
use super::schema::draft_catalog_json;
use super::service::{ActiveCatalog, ActiveUniverse, SelectionUnsupported};
use super::universe::ObservedUniverse;
use crate::domains::agents::auth::context::ActiveAuthContexts;

fn draft_catalog() -> ActiveCatalog {
    let document = parse_agent_catalog_json(draft_catalog_json()).expect("draft must load");
    ActiveCatalog::new(Arc::new(document))
}

fn contexts(ids: &[&str]) -> ActiveAuthContexts {
    ActiveAuthContexts::test_from_ids(ids.iter().copied())
}

fn observed(ids: &[&str]) -> ObservedUniverse {
    ObservedUniverse::from_observation(ids.iter().copied())
}

/// **The safety net.** With no observation, the universe-aware entry point and the
/// plain one must agree on every answer — accept, gate, and unknown alike.
///
/// This is what makes the change safe for a machine that has never probed and for
/// every surface with no runtime attached: they validate exactly as they did
/// before probing existed.
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

/// An observation makes a catalog model available even where the catalog's
/// `availability.anyOf` would gate it.
///
/// This is the gap being closed, stated as behavior: `claude-opus-4-8` ships as
/// `anthropic-api`/`anthropic-oauth` only, so a gateway-routed launch of it is
/// rejected pre-probe even when the proxy serves it. Once the machine's composed
/// observation carries it, the launch succeeds — no catalog release required. The
/// observation is the truth wherever it exists.
#[test]
fn an_observation_unlocks_a_catalog_model_the_catalog_gates() {
    let catalog = draft_catalog();
    let active = contexts(&["gateway"]);

    let refused = catalog
        .validate_launch("claude", &active, Some("claude-opus-4-8"), None)
        .expect_err("the shipped catalog does not serve this model over the gateway");
    assert!(matches!(
        refused,
        SelectionUnsupported::UnsupportedModel { .. }
    ));

    let universe = observed(&["claude-opus-4-8", "claude-sonnet-4-5"]);
    let selection = catalog
        .validate_launch_in_universe("claude", &active, Some("claude-opus-4-8"), None, &universe)
        .expect("the machine observed this model");
    assert_eq!(selection.model_id.as_deref(), Some("claude-opus-4-8"));
    assert_eq!(selection.launch_model_id.as_deref(), Some("claude-opus-4-8"));
}

/// A model the shipped catalog has never heard of, present in the observation,
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
        SelectionUnsupported::UnsupportedModel { .. }
    ));

    let universe = observed(&[brand_new]);
    let selection = catalog
        .validate_launch_in_universe("claude", &active, Some(brand_new), None, &universe)
        .expect("present in the observation");
    assert_eq!(selection.model_id.as_deref(), Some(brand_new));
    assert_eq!(selection.launch_model_id.as_deref(), Some(brand_new));
}

/// An uncatalogued id the observation does NOT carry is refused — there is
/// no "observed under another context" middle state, because the composed
/// observation has no contexts.
#[test]
fn an_uncatalogued_model_the_observation_lacks_is_refused() {
    let catalog = draft_catalog();
    let universe = observed(&["claude-sonnet-4-5"]);

    let error = catalog
        .validate_launch_in_universe(
            "claude",
            &contexts(&["anthropic-api"]),
            Some("claude-opus-5-20260901"),
            None,
            &universe,
        )
        .expect_err("neither the catalog nor the observation knows it");
    assert!(matches!(
        error,
        SelectionUnsupported::UnsupportedModel { .. }
    ));
}

/// **Garbage is still garbage.** An id nothing observed and the catalog does not carry
/// is refused, whatever else the universe holds.
#[test]
fn garbage_is_rejected_even_with_a_rich_universe() {
    let catalog = draft_catalog();
    let universe = observed(&["claude-sonnet-4-5", "claude-opus-4-6", "sonnet", "haiku"]);

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
            Err(SelectionUnsupported::UnsupportedModel { model_id, .. }) => {
                assert_eq!(model_id, garbage)
            }
            Err(other) => panic!("expected UnsupportedModel for {garbage:?}, got {other:?}"),
        }
    }
}

/// **Proof B8 (single refusal).** A saved model intent the active universe
/// cannot serve gets exactly one typed refusal — `UnsupportedModel`, the
/// `SESSION_MODEL_UNSUPPORTED` wire code — naming the universe that refused
/// and enumerating nothing (no gated middle state, no `availability.anyOf`
/// payload, no per-context anything).
///
/// This is the downgraded-key case: when a gateway key loses access to a
/// model, the proxy stops listing it and the machine's composed observation
/// records that. Launch then refuses — rather than accepting and meeting a
/// provider 403 mid-session: same outcome, discovered later, attributed to
/// the wrong layer. The refusal is model-scoped, never a blanket distrust of
/// the observation, and it fires ONLY for a model in neither the observation
/// nor the trial-verified catalog set (the trial exemption is pinned by
/// `trial_verified_models_stay_launchable_against_the_real_probe_fixture`).
#[test]
fn proof_b8_an_unservable_intent_gets_the_single_unsupported_refusal() {
    let catalog = draft_catalog();
    let active = contexts(&["gateway", "anthropic-oauth"]);
    // The auth still serves sonnet and haiku, but opus-4-6 has been revoked.
    let downgraded = observed(&["claude-sonnet-4-5", "claude-haiku-4-5"]);

    let error = catalog
        .validate_launch_in_universe("claude", &active, Some("claude-opus-4-6"), None, &downgraded)
        .expect_err("the machine's own observation says the composed auth cannot serve it");
    assert_eq!(
        error,
        SelectionUnsupported::UnsupportedModel {
            model_id: "claude-opus-4-6".to_string(),
            active_universe: ActiveUniverse::MachineObservation,
        },
        "one refusal, naming the universe and nothing else"
    );
    assert_eq!(
        ActiveUniverse::MachineObservation.describe(),
        "the machine's composed observation",
        "the refusal detail names the universe with static, credential-free text"
    );

    // A model the same observation DOES carry still launches.
    catalog
        .validate_launch_in_universe(
            "claude",
            &active,
            Some("claude-sonnet-4-5"),
            None,
            &downgraded,
        )
        .expect("an observed model still launches under the same auth");

    // Pre-probe the same refusal fires from the seed, distinguished only by
    // the universe it names.
    let pre_probe = catalog
        .validate_launch_in_universe(
            "claude",
            &contexts(&["anthropic-oauth"]),
            Some("opus[1m]"),
            None,
            &ObservedUniverse::empty(),
        )
        .expect_err("api-only model is unservable under oauth pre-probe");
    assert_eq!(
        pre_probe,
        SelectionUnsupported::UnsupportedModel {
            model_id: "opus[1m]".to_string(),
            active_universe: ActiveUniverse::CatalogSeed,
        }
    );
}

/// **Proof B8 (grep gate).** The gated taxonomy no longer exists anywhere in
/// the anyharness tree — runtime crates, contract crate, and SDK sources —
/// so the deleted concepts stay deleted. The needles are assembled at
/// runtime, which keeps this file from tripping its own gate.
#[test]
fn proof_b8_the_gated_taxonomy_stays_deleted() {
    let anyharness_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crates/anyharness-lib sits two levels under anyharness/")
        .to_path_buf();
    assert!(
        anyharness_root.join("crates").is_dir() && anyharness_root.join("sdk").is_dir(),
        "grep gate must scan the anyharness tree, resolved {anyharness_root:?}"
    );

    let needles = [
        format!("SESSION_MODEL_{}", "GATED"),
        format!("required{}contexts", '_'),
        format!("required{}ontexts", 'C'),
        format!("Model{}", "Gated"),
    ];
    let mut offenders = Vec::new();
    scan_for_needles(&anyharness_root, &needles, &mut offenders);
    assert!(
        offenders.is_empty(),
        "the gated launch taxonomy must stay deleted; found: {offenders:#?}"
    );
}

/// Recursive text scan for the grep gate. Skips build output and vendored
/// dependency trees; everything else in the anyharness tree is fair game.
fn scan_for_needles(dir: &std::path::Path, needles: &[String], offenders: &mut Vec<String>) {
    let entries = std::fs::read_dir(dir).expect("readable directory");
    for entry in entries {
        let entry = entry.expect("readable directory entry");
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if path.is_dir() {
            if matches!(name.as_ref(), "target" | "node_modules" | "dist" | ".git") {
                continue;
            }
            scan_for_needles(&path, needles, offenders);
            continue;
        }
        let Ok(contents) = std::fs::read_to_string(&path) else {
            continue; // Non-UTF-8 (binary) files carry no source symbols.
        };
        for needle in needles {
            if contents.contains(needle.as_str()) {
                offenders.push(format!("{}: {needle}", path.display()));
            }
        }
    }
}

/// **Trial-verified rows survive the observation's silence**, against the real
/// catalog and the real probe fixture.
///
/// `claude.anthropic-api.probe.json` (harness 2.1.233) advertises exactly five
/// selectors (`default`, `opus[1m]`, `sonnet`, `haiku`, and `claude-opus-4-8` —
/// the last as "Newer version available · select Opus for Opus 5") while the
/// shipped catalog additionally carries `claude-fable-5` for that same auth as
/// `viaTrialOnly` — the pipeline verified it by launching it, *because* the
/// harness does not list it. A plain observation-first refusal would refuse a
/// launch that provably works; the exemption is what makes the strict reading
/// safe. `claude-opus-4-8` graduated OUT of the exemption when 2.1.233 began
/// listing it directly: it launches via the observed path, and its flag is
/// pinned `false` below so a future catalog cannot silently re-enroll it.
///
/// The first assertions pin the catalog facts the exemption depends on, so this
/// fails loudly if a future catalog drops or re-adds a flag rather than
/// silently changing behavior.
#[test]
fn trial_verified_models_stay_launchable_against_the_real_probe_fixture() {
    let catalog = draft_catalog();
    let active = contexts(&["anthropic-api"]);
    // Exactly what the real fixture advertises.
    let universe = observed(&["default", "opus[1m]", "sonnet", "haiku", "claude-opus-4-8"]);

    let agent = catalog.agent("claude").expect("claude");
    for (id, trial_only) in [("claude-fable-5", true), ("claude-opus-4-8", false)] {
        let model = agent
            .session
            .models
            .iter()
            .find(|model| model.id == id)
            .unwrap_or_else(|| panic!("{id} in the catalog"));
        assert_eq!(
            model
                .provenance
                .as_ref()
                .and_then(|provenance| provenance.via_trial_only),
            Some(trial_only),
            "{id} viaTrialOnly must match the 2.1.233 probe fixture (fable-5 is \
             trial-verified because the harness does not list it; opus-4-8 is \
             listed directly), or the exemption below is mis-scoped and a launch \
             legitimately regresses"
        );
        let selection = catalog
            .validate_launch_in_universe("claude", &active, Some(id), None, &universe)
            .unwrap_or_else(|error| panic!("{id} must stay launchable, got {error:?}"));
        assert_eq!(selection.model_id.as_deref(), Some(id));
    }

    // Against the real catalog, every `anthropic-api` model is either one of the
    // fixture's five observed selectors or `viaTrialOnly`. This asserts that set is
    // empty, not merely convenient — a future catalog addition that is neither
    // observed nor trial-flagged would silently skip the refusal check instead
    // of failing loudly, so the emptiness itself is pinned first.
    let unexempt_and_unobserved: Vec<&str> = agent
        .session
        .models
        .iter()
        .filter(|model| {
            model
                .availability
                .any_of
                .iter()
                .any(|id| id == "anthropic-api")
                && model
                    .provenance
                    .as_ref()
                    .and_then(|provenance| provenance.via_trial_only)
                    != Some(true)
                && !["default", "opus[1m]", "sonnet", "haiku", "claude-opus-4-8"]
                    .contains(&model.id.as_str())
        })
        .map(|model| model.id.as_str())
        .collect();
    assert!(
        unexempt_and_unobserved.is_empty(),
        "the real catalog's anthropic-api models are all either observed by the fixture \
         or viaTrialOnly; {unexempt_and_unobserved:?} would need the refusal this test \
         cannot currently exercise — extend the fixture's observed set or this test's \
         explicit refusal case instead of leaving it untested"
    );
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
    let universe = observed(&[
        "default[]",
        "grok-4.5[effort=high,fast=true]",
        "composer-2.5[fast=true]",
    ]);

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
    let universe = observed(&[brand_new]);

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
    assert!(matches!(error, SelectionUnsupported::UnsupportedMode { .. }));
}

/// A default selection follows the observation too, in both directions.
///
/// The curated default is consulted first and wins whenever the machine can serve it.
/// When it cannot — the observation does not carry it — the default falls through to
/// a model that IS serveable, rather than advertising a default that launch would
/// then reject. That agreement between "what we default to" and "what we accept" is
/// the point of both reading one universe.
#[test]
fn a_default_selection_follows_the_observation() {
    let catalog = draft_catalog();
    let active = contexts(&["gateway"]);

    // The curated gateway default, observed present: it wins.
    let curated = observed(&["claude-sonnet-4-5", "claude-opus-4-8"]);
    assert_eq!(
        catalog
            .validate_launch_in_universe("claude", &active, None, None, &curated)
            .expect("a default resolves")
            .model_id
            .as_deref(),
        Some("claude-sonnet-4-5"),
        "the curated default wins whenever the machine can serve it"
    );

    // The curated default observed ABSENT: the default must move to something the
    // machine actually serves, and that choice must itself validate.
    let without_default = observed(&["claude-opus-4-8"]);
    let fallback = catalog
        .validate_launch_in_universe("claude", &active, None, None, &without_default)
        .expect("a default still resolves")
        .model_id
        .expect("some model");
    assert_ne!(
        fallback, "claude-sonnet-4-5",
        "a default the machine cannot serve must not be advertised"
    );
    catalog
        .validate_launch_in_universe("claude", &active, Some(&fallback), None, &without_default)
        .unwrap_or_else(|error| panic!("the chosen default must itself launch: {error:?}"));
}
