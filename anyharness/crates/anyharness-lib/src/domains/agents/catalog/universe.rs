//! The observed half of the launch universe (pure).
//!
//! model-catalog.md, "Universe construction": for a given harness the active
//! universe is the union of the machine snapshot entries for every active auth
//! context, and the shipped catalog fills in where an observation is silent. This
//! module is that arbitration expressed as data plus a few predicates, so the
//! truth-tier law is assertable without a runtime, a filesystem, or a probe.
//!
//! The type lives in the catalog domain rather than in `model_snapshot/` on
//! purpose: the catalog's read surface is what consults it, and pointing the
//! catalog at the snapshot module would invert a dependency that already runs the
//! other way (`model_snapshot::targets` reads the catalog).
//! `model_snapshot::universe` builds one of these from the document; nothing else
//! does.
//!
//! **An observation OVERRIDES the shipped catalog for its own context — except for
//! trial-verified rows.** The spec's tier law is written per context ("Where no fresh
//! entry exists **for an active context**, the shipped catalog's models **for that
//! context** fill in"), so a context that HAS a fresh entry is answered by that entry
//! and not by the catalog's older belief about it.
//!
//! Taken literally that would drop real capability, because the shipped catalog
//! deliberately carries *launchable-but-unadvertised* models: the central pipeline
//! marks them `provenance.viaTrialOnly`, meaning it verified them by actually
//! launching them, precisely because the harness does not list them. Those rows are
//! therefore exempt from the override and union in.
//!
//! The exemption is exactly wide enough, measured rather than assumed. Across all 13
//! real probe fixtures the only catalog rows that are available-but-unobserved are
//! `viaTrialOnly` ones — claude's `claude-fable-5` and `claude-opus-4-8` under
//! `anthropic-api`/`anthropic-oauth`, and `global.anthropic.claude-fable-5` under
//! `bedrock`, with zero non-trial cases anywhere. So trial-exempt override keeps
//! 100% of provably-launchable capability while still letting an observation say no.
//!
//! What the override buys, and why it is worth the strictness: a *pre-launch*
//! rejection. When a gateway key is downgraded so the proxy stops serving a model,
//! the observation records that, and launch refuses with `SESSION_MODEL_GATED`
//! naming what would unlock it. A blanket union would accept the launch and the user
//! would meet a mid-session provider 403 instead — the same outcome, discovered later
//! and less legibly.
//!
//! **A fresh entry with no models is not an observation.** A harness that
//! advertised an empty list would otherwise contribute nothing while still counting
//! as observed; dropping it keeps the failure mode a stale menu rather than a
//! narrower one (model-catalog.md, "Failure modes": never an empty picker).

use std::collections::{BTreeMap, BTreeSet};

use super::schema::AgentCatalogModel;

/// Observed model ids per auth context, from FRESH snapshot entries only.
///
/// Empty means "no usable observation for this harness" — the state of every
/// machine before its first probe, and the state this type degrades to so a
/// snapshot-less runtime validates exactly as it did before.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ObservedUniverse {
    observed: BTreeMap<String, BTreeSet<String>>,
}

impl ObservedUniverse {
    /// The no-observation universe: every model's availability is the shipped
    /// catalog's, which is byte-for-byte today's behavior.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Build from (auth context id, observed model ids) pairs. Contexts whose list
    /// is empty are dropped rather than recorded as an observation of nothing.
    pub fn from_observations<I, S>(observations: I) -> Self
    where
        I: IntoIterator<Item = (String, Vec<S>)>,
        S: Into<String>,
    {
        let mut observed = BTreeMap::new();
        for (context_id, model_ids) in observations {
            let ids: BTreeSet<String> = model_ids.into_iter().map(Into::into).collect();
            if ids.is_empty() {
                continue;
            }
            observed.insert(context_id, ids);
        }
        Self { observed }
    }

    pub fn is_empty(&self) -> bool {
        self.observed.is_empty()
    }

    /// Does this context carry a usable observation? False means the shipped
    /// catalog is the only thing that knows about it.
    pub fn has_observation(&self, auth_context_id: &str) -> bool {
        self.observed.contains_key(auth_context_id)
    }

    /// Was this exact id observed under this context? Used for a model the shipped
    /// catalog does not know at all, whose only identity is the observed id.
    pub fn observes_id(&self, auth_context_id: &str, model_id: &str) -> bool {
        self.observed
            .get(auth_context_id)
            .is_some_and(|ids| ids.contains(model_id))
    }

    /// Was this catalog model observed under this context — by id, alias, or
    /// probe-observed variant id?
    ///
    /// The variant leg is load-bearing, not defensive: cursor advertises only
    /// composed forms (`grok-4.5[effort=high,fast=true]`), so matching the bare id
    /// alone would leave every cursor model unobserved the moment its snapshot
    /// landed. The candidate set is the same one the catalog already resolves a
    /// requested id through.
    pub fn observes_model(&self, auth_context_id: &str, model: &AgentCatalogModel) -> bool {
        let Some(ids) = self.observed.get(auth_context_id) else {
            return false;
        };
        if ids.contains(&model.id) {
            return true;
        }
        if model.aliases.iter().any(|alias| ids.contains(alias)) {
            return true;
        }
        model
            .provenance
            .as_ref()
            .is_some_and(|provenance| provenance.variant_ids.iter().any(|id| ids.contains(id)))
    }

    /// Contexts whose observation carries this exact id, in id order.
    pub fn contexts_observing_id(&self, model_id: &str) -> Vec<String> {
        self.observed
            .iter()
            .filter(|(_, ids)| ids.contains(model_id))
            .map(|(context_id, _)| context_id.clone())
            .collect()
    }

    /// Contexts whose observation carries this catalog model, in id order.
    pub fn contexts_observing_model(&self, model: &AgentCatalogModel) -> Vec<String> {
        self.observed
            .keys()
            .filter(|context_id| self.observes_model(context_id, model))
            .cloned()
            .collect()
    }
}

/// Was this model verified by launching it rather than by being advertised?
///
/// `viaTrialOnly` is the central pipeline's record that it probed the harness, did
/// NOT see the model in the advertised list, and then launched it successfully
/// anyway. A machine's own observation of the same context will likewise not list
/// it, so overriding on that silence would refuse a launch the pipeline proved works.
fn is_trial_verified(model: &AgentCatalogModel) -> bool {
    model
        .provenance
        .as_ref()
        .and_then(|provenance| provenance.via_trial_only)
        .unwrap_or(false)
}

/// Every context that could serve `model` — the unlock condition a `ModelGated`
/// rejection names (model-catalog.md, "Launch validation": *"`required_contexts`
/// naming the contexts whose snapshot entries (or catalog availability, pre-probe)
/// contain the model"*).
///
/// A context qualifies when it observed the model, or when the catalog declares it
/// and the observation cannot contradict that — either because no fresh entry exists
/// for that context, or because the model is trial-verified (see
/// [`is_trial_verified`]).
///
/// Observed contexts come first so the most specific truth reads first; with an empty
/// universe the result is `availability.anyOf` verbatim, in catalog order, so a
/// pre-probe machine's rejection payload is unchanged.
pub fn contexts_serving_model(
    model: &AgentCatalogModel,
    universe: &ObservedUniverse,
) -> Vec<String> {
    let trial_verified = is_trial_verified(model);
    let mut serving = universe.contexts_observing_model(model);
    for context_id in &model.availability.any_of {
        if universe.has_observation(context_id) && !trial_verified {
            // This context was observed and does not serve the model. Naming it would
            // tell the user to enable a route that cannot run what they asked for.
            continue;
        }
        if !serving.contains(context_id) {
            serving.push(context_id.clone());
        }
    }
    serving
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema::{
        AgentCatalogAvailability, AgentCatalogModelProvenance,
    };
    use crate::domains::agents::model::ModelCatalogStatus;

    fn model(id: &str, available_in: &[&str]) -> AgentCatalogModel {
        AgentCatalogModel {
            id: id.to_string(),
            display_name: id.to_string(),
            description: None,
            aliases: Vec::new(),
            family: None,
            availability: AgentCatalogAvailability {
                any_of: available_in.iter().map(|id| id.to_string()).collect(),
            },
            default_visible: true,
            controls: Default::default(),
            status: ModelCatalogStatus::Active,
            provenance: None,
        }
    }

    fn provenance(variant_ids: &[&str]) -> AgentCatalogModelProvenance {
        AgentCatalogModelProvenance {
            observed_in: Vec::new(),
            observed_in_all_contexts: None,
            via_trial_only: None,
            variant_ids: variant_ids.iter().map(|id| id.to_string()).collect(),
        }
    }

    #[test]
    fn an_observation_of_nothing_is_not_an_observation() {
        let universe = ObservedUniverse::from_observations(vec![
            ("gateway".to_string(), Vec::<String>::new()),
            ("anthropic-api".to_string(), vec!["sonnet".to_string()]),
        ]);
        assert!(
            !universe.has_observation("gateway"),
            "an empty model list must not count as an observation"
        );
        assert!(universe.has_observation("anthropic-api"));
    }

    #[test]
    fn a_model_matches_by_id_alias_or_variant() {
        let mut aliased = model("claude-opus-4-8", &["anthropic-api"]);
        aliased.aliases = vec!["opus-latest".to_string()];
        let mut variant = model("grok-4.5", &["cursor-login"]);
        variant.provenance = Some(provenance(&["grok-4.5[effort=high,fast=true]"]));

        let by_id = ObservedUniverse::from_observations(vec![(
            "anthropic-api".to_string(),
            vec!["claude-opus-4-8"],
        )]);
        assert!(by_id.observes_model("anthropic-api", &aliased));

        let by_alias = ObservedUniverse::from_observations(vec![(
            "anthropic-api".to_string(),
            vec!["opus-latest"],
        )]);
        assert!(by_alias.observes_model("anthropic-api", &aliased));

        // The cursor shape: only the composed form is ever advertised.
        let by_variant = ObservedUniverse::from_observations(vec![(
            "cursor-login".to_string(),
            vec!["grok-4.5[effort=high,fast=true]"],
        )]);
        assert!(
            by_variant.observes_model("cursor-login", &variant),
            "a variant-only observation must still count as observing its base model"
        );
        assert!(!by_variant.observes_model("cursor-login", &aliased));
    }

    /// The empty universe must reproduce `availability.anyOf` exactly, or every
    /// pre-probe machine's gated-rejection payload changes shape.
    #[test]
    fn an_empty_universe_names_exactly_the_catalog_availability() {
        let model = model("sonnet", &["anthropic-api", "anthropic-oauth"]);
        assert_eq!(
            contexts_serving_model(&model, &ObservedUniverse::empty()),
            vec!["anthropic-api", "anthropic-oauth"]
        );
    }

    /// An observation OVERRIDES its own context: a model the catalog declares there
    /// but the machine did not observe stops being serveable by that context.
    ///
    /// This is the downgraded-key case. When a gateway key loses access to a model the
    /// proxy stops listing it, the observation records that, and the user gets a
    /// pre-launch `ModelGated` naming what would unlock it — rather than a launch that
    /// is accepted and then dies on a provider 403 mid-session.
    #[test]
    fn an_observation_overrides_its_own_context() {
        let model = model("claude-fable-5", &["anthropic-api", "anthropic-oauth"]);
        let universe = ObservedUniverse::from_observations(vec![
            // Both catalog contexts observed, NEITHER serving the model — the shape a
            // downgraded key produces.
            ("anthropic-api".to_string(), vec!["sonnet", "haiku"]),
            ("anthropic-oauth".to_string(), vec!["sonnet", "opus"]),
            // And one context observed WITH it that the catalog does not list.
            ("gateway".to_string(), vec!["claude-fable-5"]),
        ]);
        assert_eq!(
            contexts_serving_model(&model, &universe),
            vec!["gateway"],
            "observed contexts that lack the model are dropped; the one that has it is added"
        );

        // An UNOBSERVED catalog context still fills in — the tier law's own words.
        let partial = ObservedUniverse::from_observations(vec![(
            "anthropic-api".to_string(),
            vec!["sonnet"],
        )]);
        assert_eq!(
            contexts_serving_model(&model, &partial),
            vec!["anthropic-oauth"],
            "a context with no fresh entry keeps its catalog declaration"
        );
    }

    /// **Trial-verified rows are exempt from the override.**
    ///
    /// `viaTrialOnly` means the central pipeline probed, did not see the model
    /// advertised, and launched it successfully anyway. A machine's own observation of
    /// that context will be equally silent, so overriding on that silence would refuse
    /// a launch that is proven to work. Same universe as the test above, one flag
    /// different, opposite answer.
    #[test]
    fn a_trial_verified_row_survives_an_observation_that_omits_it() {
        let mut model = model("claude-fable-5", &["anthropic-api", "anthropic-oauth"]);
        model.provenance = Some(AgentCatalogModelProvenance {
            via_trial_only: Some(true),
            ..provenance(&[])
        });
        let universe = ObservedUniverse::from_observations(vec![(
            "anthropic-api".to_string(),
            vec!["sonnet", "haiku"],
        )]);
        assert_eq!(
            contexts_serving_model(&model, &universe),
            vec!["anthropic-api", "anthropic-oauth"],
            "a launchable-but-unadvertised model must not be dropped by the silence \
             that defines it"
        );
    }

    #[test]
    fn an_uncatalogued_id_is_explained_by_the_contexts_that_observed_it() {
        let universe = ObservedUniverse::from_observations(vec![
            ("gateway".to_string(), vec!["brand-new-model"]),
            ("anthropic-api".to_string(), vec!["sonnet"]),
        ]);
        assert_eq!(
            universe.contexts_observing_id("brand-new-model"),
            vec!["gateway"]
        );
        assert!(universe
            .contexts_observing_id("nothing-serves-this")
            .is_empty());
    }
}
