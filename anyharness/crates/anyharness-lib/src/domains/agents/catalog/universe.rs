//! The observed half of the launch universe (pure).
//!
//! model-catalog.md, "Serving": **the observation is the truth wherever it
//! exists; nothing overrides it.** One composed observation per harness — there
//! is no per-context map and no cross-context union, because there are no
//! contexts on the observation side: the probe spawns the harness into its full
//! composed auth world, so the observed list IS the menu a session launched
//! right now would show. Where no observation exists, the shipped catalog's
//! declarations serve as the seed.
//!
//! The type lives in the catalog domain rather than in `model_snapshot/` on
//! purpose: the catalog's read surface is what consults it.
//! `model_snapshot::universe` builds one of these from the document; nothing else
//! does.
//!
//! **One exemption: trial-verified rows.** The shipped catalog deliberately
//! carries *launchable-but-unadvertised* models: the central pipeline marks them
//! `provenance.viaTrialOnly`, meaning it verified them by actually launching them,
//! precisely because the harness does not list them. A machine's own observation
//! is equally silent about them, so refusing on that silence would refuse a
//! launch that is proven to work. Those rows stay catalog-governed even when an
//! observation exists.
//!
//! **An observation of nothing is not an observation.** A harness that advertised
//! an empty list would otherwise override the seed with an empty picker; dropping
//! it keeps the failure mode a stale menu rather than an empty one
//! (model-catalog.md, "Failure modes": never an empty picker).

use std::collections::BTreeSet;

use super::schema::AgentCatalogModel;

/// The composed observation's model ids for one harness, or nothing.
///
/// Empty means "no usable observation for this harness" — the state of every
/// machine before its first probe, and the state this type degrades to so a
/// snapshot-less runtime validates exactly as it did before.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ObservedUniverse {
    observed: Option<BTreeSet<String>>,
}

impl ObservedUniverse {
    /// The no-observation universe: every model's availability is the shipped
    /// catalog's, which is byte-for-byte the pre-probe behavior.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Build from the observation's model ids. An empty list yields the empty
    /// universe rather than an observation of nothing.
    pub fn from_observation<I, S>(model_ids: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let ids: BTreeSet<String> = model_ids.into_iter().map(Into::into).collect();
        Self {
            observed: (!ids.is_empty()).then_some(ids),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.observed.is_none()
    }

    /// Does this harness carry a usable observation? False means the shipped
    /// catalog is the only thing that knows about it.
    pub fn has_observation(&self) -> bool {
        self.observed.is_some()
    }

    /// Was this exact id observed? Used for a model the shipped catalog does not
    /// know at all, whose only identity is the observed id.
    pub fn observes_id(&self, model_id: &str) -> bool {
        self.observed
            .as_ref()
            .is_some_and(|ids| ids.contains(model_id))
    }

    /// Was this catalog model observed — by id, alias, or probe-observed variant
    /// id?
    ///
    /// The variant leg is load-bearing, not defensive: cursor advertises only
    /// composed forms (`grok-4.5[effort=high,fast=true]`), so matching the bare id
    /// alone would leave every cursor model unobserved the moment its snapshot
    /// landed. The candidate set is the same one the catalog already resolves a
    /// requested id through.
    pub fn observes_model(&self, model: &AgentCatalogModel) -> bool {
        let Some(ids) = self.observed.as_ref() else {
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
}

/// Was this model verified by launching it rather than by being advertised?
///
/// `viaTrialOnly` is the central pipeline's record that it probed the harness, did
/// NOT see the model in the advertised list, and then launched it successfully
/// anyway. A machine's own observation will likewise not list it, so refusing on
/// that silence would refuse a launch the pipeline proved works.
pub fn is_trial_verified(model: &AgentCatalogModel) -> bool {
    model
        .provenance
        .as_ref()
        .and_then(|provenance| provenance.via_trial_only)
        .unwrap_or(false)
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
        let universe = ObservedUniverse::from_observation(Vec::<String>::new());
        assert!(
            !universe.has_observation(),
            "an empty model list must not count as an observation"
        );
        assert!(ObservedUniverse::from_observation(vec!["sonnet"]).has_observation());
    }

    #[test]
    fn a_model_matches_by_id_alias_or_variant() {
        let mut aliased = model("claude-opus-4-8", &["anthropic-api"]);
        aliased.aliases = vec!["opus-latest".to_string()];
        let mut variant = model("grok-4.5", &["cursor-login"]);
        variant.provenance = Some(provenance(&["grok-4.5[effort=high,fast=true]"]));

        let by_id = ObservedUniverse::from_observation(vec!["claude-opus-4-8"]);
        assert!(by_id.observes_model(&aliased));

        let by_alias = ObservedUniverse::from_observation(vec!["opus-latest"]);
        assert!(by_alias.observes_model(&aliased));

        // The cursor shape: only the composed form is ever advertised.
        let by_variant =
            ObservedUniverse::from_observation(vec!["grok-4.5[effort=high,fast=true]"]);
        assert!(
            by_variant.observes_model(&variant),
            "a variant-only observation must still count as observing its base model"
        );
        assert!(!by_variant.observes_model(&aliased));
    }

    #[test]
    fn trial_verification_reads_the_provenance_flag() {
        let mut trial = model("claude-fable-5", &["anthropic-api"]);
        assert!(!is_trial_verified(&trial));
        trial.provenance = Some(AgentCatalogModelProvenance {
            via_trial_only: Some(true),
            ..provenance(&[])
        });
        assert!(is_trial_verified(&trial));
    }
}
