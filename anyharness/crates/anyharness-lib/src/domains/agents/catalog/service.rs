//! The single read surface over the active agent catalog.
//!
//! Every runtime consumer of catalog data goes through here: installer
//! pins, model menus, control matrices, and launch validation.
//!
//! Semantic rules:
//! - `defaultVisible` is the menu, `availability` is the truth:
//!   [`ActiveCatalog::validate_launch`] accepts launchable-but-unadvertised
//!   models (available under the active contexts but not default-visible).
//! - Availability is observation-first: where a composed observation exists it IS
//!   the available set (trial-verified rows exempt — `universe.rs` carries the
//!   reasoning), and where none exists the catalog's per-context declarations
//!   serve as the seed, with `"baseline"` counting like any other context when it
//!   is active. A machine with no snapshot validates exactly as it did before
//!   probing existed.
//! - Models are entities, never modes; variant launch ids (`variantSyntax`)
//!   resolve to their base model for availability and control checks while
//!   the composed variant id is preserved as the launch id.

use std::collections::BTreeMap;
use std::sync::Arc;

use super::schema::{
    AgentCatalogAgent, AgentCatalogArtifactPin, AgentCatalogArtifactSource,
    AgentCatalogAuthContext, AgentCatalogDocument, AgentCatalogHarnessPins, AgentCatalogModel,
    AgentCatalogModelControl, AgentCatalogPinTarget,
};
use super::selection::{
    default_model, find_model, model_is_available, resolve_requested_model, validate_mode,
    ResolvedModel,
};
use super::sync::CatalogSyncService;
use super::universe::ObservedUniverse;
use crate::domains::agents::auth::context::ActiveAuthContexts;
use crate::domains::agents::installer::install_policy::{
    PinOverrides, ResolvedPinSource, ResolvedPinTarget,
};
use crate::domains::agents::model::ModelCatalogStatus;

/// Read surface over the active catalog held by [`CatalogSyncService`].
#[derive(Clone)]
pub struct AgentCatalogService {
    sync: Arc<CatalogSyncService>,
}

impl AgentCatalogService {
    pub fn new(sync: Arc<CatalogSyncService>) -> Self {
        Self { sync }
    }

    /// Catalog pin overrides for the installer (None when the kind is
    /// unknown to the active catalog). Carries both the version (drift) and
    /// the resolved, fenced install source (materialization) per role.
    pub fn pin_overrides(&self, kind: &str) -> Option<PinOverrides> {
        self.active_catalog().pin_overrides(kind)
    }

    pub fn active_catalog(&self) -> ActiveCatalog {
        ActiveCatalog::new(self.sync.active().document)
    }
}

/// Placeholder pins ("unknown" — e.g. cursor pre manifest-provenance) must
/// not drive drift: an unknowable pin is no pin.
fn usable_version(version: &str) -> Option<String> {
    (!version.is_empty() && version != "unknown").then(|| version.to_string())
}

/// The comparable install identity used for version-drift detection.
///
/// Git-sourced pins are materialized and recorded by their resolved commit
/// sha, not the catalog's human-readable `version` label — see
/// `installer::managed_npm::npm_package_version`'s non-registry-spec
/// handling (git/github/file/http(s) specs), which treats the text after `#`
/// as the installed artifact's recorded "version". Comparing that recorded
/// sha against a semver-looking label like `"0.44.0"` never converges: it
/// would force a reinstall on every startup reconcile pass forever. Use the
/// same git ref on the pinned side so the comparison can actually match once
/// installed. Non-git sources are unaffected: they already record the
/// declared label (Binary/Archive install it verbatim; registry Npm specs
/// read a matching version back from the installed package.json).
fn pin_identity(declared_version: &str, source: Option<&ResolvedPinSource>) -> Option<String> {
    match source {
        Some(ResolvedPinSource::Git { git_ref, .. }) => usable_version(git_ref),
        _ => usable_version(declared_version),
    }
}

/// Project a catalog artifact pin's resolved source (schema) into the
/// installer-domain `ResolvedPinSource`. `None` when the pin has no source
/// (legacy pre-lockfile pin) — the installer then uses the registry spec.
fn project_source(pin: &AgentCatalogArtifactPin) -> Option<ResolvedPinSource> {
    let targets = |targets: &BTreeMap<String, AgentCatalogPinTarget>| {
        targets
            .iter()
            .map(|(platform, target)| {
                (
                    platform.clone(),
                    ResolvedPinTarget {
                        url: target.url.clone(),
                        sha256: target.sha256.clone(),
                        download_size_bytes: target.download_size_bytes,
                        expected_binary: target.expected_binary.clone(),
                    },
                )
            })
            .collect()
    };
    Some(match pin.source.as_ref()? {
        AgentCatalogArtifactSource::Binary { targets: t } => ResolvedPinSource::Binary {
            targets: targets(t),
        },
        AgentCatalogArtifactSource::Archive { targets: t, args } => ResolvedPinSource::Archive {
            targets: targets(t),
            args: args.clone(),
        },
        AgentCatalogArtifactSource::Npm {
            package,
            sha256,
            args,
        } => ResolvedPinSource::Npm {
            package: package.clone(),
            sha256: sha256.clone(),
            args: args.clone(),
        },
        AgentCatalogArtifactSource::Git {
            repo,
            git_ref,
            package_subdir,
            executable_relpath,
        } => ResolvedPinSource::Git {
            repo: repo.clone(),
            git_ref: git_ref.clone(),
            package_subdir: package_subdir.clone(),
            executable_relpath: executable_relpath.clone(),
        },
    })
}

/// A pinned catalog snapshot: readers borrow from it for as long as they
/// hold it, and keep a consistent document across concurrent sync swaps.
#[derive(Debug, Clone)]
pub struct ActiveCatalog {
    document: Arc<AgentCatalogDocument>,
}

/// The validated launch selection for one session create.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSelection {
    /// Canonical catalog model id; `None` means "no selection" (the harness
    /// picks its own default — mirrors the v1 no-default behavior).
    pub model_id: Option<String>,
    /// The id the session launches with: the composed variant id when the
    /// request used `variantSyntax` (e.g. `"gpt-5.5/xhigh"`), else the
    /// canonical model id.
    pub launch_model_id: Option<String>,
    pub mode_id: Option<String>,
}

/// Structured launch-selection rejections (expected outcomes, not errors).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectionUnsupported {
    UnknownAgent {
        agent_kind: String,
    },
    /// The requested model is not in the catalog (by id, alias, or variant).
    UnknownModel {
        model_id: String,
    },
    /// In the catalog, but not available under the active auth contexts.
    /// Carries the requested spelling separately from the canonical catalog
    /// identity so callers retain the exact rejected selection without
    /// confusing an alias or variant with the model that owned the gate.
    /// `required_contexts` is `availability.anyOf` — the unlock condition.
    ModelGated {
        requested_model_id: String,
        canonical_model_id: String,
        active_contexts: Vec<String>,
        required_contexts: Vec<String>,
        catalog_version: String,
    },
    UnsupportedMode {
        mode_id: String,
    },
}

impl ActiveCatalog {
    pub fn new(document: Arc<AgentCatalogDocument>) -> Self {
        Self { document }
    }

    pub fn agents(&self) -> &[AgentCatalogAgent] {
        &self.document.agents
    }

    pub fn catalog_version(&self) -> &str {
        &self.document.catalog_version
    }

    pub fn agent(&self, kind: &str) -> Option<&AgentCatalogAgent> {
        self.agents().iter().find(|agent| agent.kind == kind)
    }

    /// Harness version pins for the kind (installer + readiness drift).
    pub fn pins(&self, kind: &str) -> Option<&AgentCatalogHarnessPins> {
        self.agent(kind).map(|agent| &agent.harness)
    }

    pub(crate) fn pin_overrides(&self, kind: &str) -> Option<PinOverrides> {
        let pins = self.pins(kind)?;
        let agent_process_source = project_source(&pins.agent_process);
        let native_source = pins.native.as_ref().and_then(project_source);
        Some(PinOverrides {
            agent_process: pin_identity(&pins.agent_process.version, agent_process_source.as_ref()),
            native: pins
                .native
                .as_ref()
                .and_then(|pin| pin_identity(&pin.version, native_source.as_ref())),
            agent_process_source,
            native_source,
        })
    }

    /// The agent's ordered auth-context signatures (classifier input).
    pub fn auth_contexts(&self, kind: &str) -> Option<&[AgentCatalogAuthContext]> {
        self.agent(kind).map(|agent| agent.auth_contexts.as_slice())
    }

    /// Version-level goal support declared for the pinned harness. The live
    /// session capability stays ACP-advertised (initialize `_meta`); this is
    /// the catalog-declared flag for surfaces without a live handshake.
    ///
    /// MUST NOT gate a live goal mutation: that authority is solely the
    /// session's `_meta.anyharness.goals.supported` initialize advertisement
    /// (see `domains::goals::runtime` + `supports_goals_from_init_meta`). This
    /// flag can legitimately drift ahead
    /// of the pinned sidecar binary (declared before the fork ships the ext
    /// methods), so trusting it to drive a mutation would try to set goals on a
    /// sidecar that cannot service them. It exists only for pre-session
    /// surfaces (e.g. an agent picker) that have no live handshake to consult.
    pub fn supports_goals(&self, kind: &str) -> bool {
        self.agent(kind)
            .map(|agent| agent.session.supports_goals)
            .unwrap_or(false)
    }

    /// Curated mode for surfaces that deliberately run this agent unattended.
    /// `None` means no unattended mode has been vetted for the agent.
    pub fn unattended_mode_id(&self, kind: &str) -> Option<&str> {
        self.agent(kind)?.session.unattended_mode_id.as_deref()
    }

    /// Models available under the active contexts: `availability.anyOf`
    /// intersected with the active ids (`"baseline"` counts when active).
    ///
    /// Catalog-only, deliberately: projecting the machine snapshot into the PICKER
    /// is its own change (model-catalog.md, "Serving per surface", still an open
    /// gap), and widening the menu here would ship half of it — a model in the menu
    /// with no curated display name or control wiring. Launch validation reads the
    /// union through [`ActiveCatalog::validate_launch_in_universe`]; a picker that
    /// shows less than launch accepts is the pre-existing, safe direction of that
    /// asymmetry (it is already true for trial-verified rows).
    pub fn models(&self, kind: &str, contexts: &ActiveAuthContexts) -> Vec<&AgentCatalogModel> {
        let Some(agent) = self.agent(kind) else {
            return Vec::new();
        };
        let universe = ObservedUniverse::empty();
        agent
            .session
            .models
            .iter()
            .filter(|model| model_is_available(model, contexts, &universe))
            .collect()
    }

    /// The menu: `defaultVisible` ∩ available ∩ active-status.
    pub fn visible_models(
        &self,
        kind: &str,
        contexts: &ActiveAuthContexts,
    ) -> Vec<&AgentCatalogModel> {
        self.models(kind, contexts)
            .into_iter()
            .filter(|model| model.default_visible && model.status == ModelCatalogStatus::Active)
            .collect()
    }

    /// Per-model option matrix (control key -> supported values).
    pub fn controls(
        &self,
        kind: &str,
        model_id: &str,
    ) -> Option<&BTreeMap<String, AgentCatalogModelControl>> {
        let agent = self.agent(kind)?;
        find_model(agent, model_id).map(|model| &model.controls)
    }

    /// Validate a session-create selection against the catalog and the
    /// active auth contexts. Replaces `resolve_launch_model_id` +
    /// `resolve_mode_id` in the v2 era.
    ///
    /// Settled semantics:
    /// - Requested model resolves by id, alias, probe-observed variant id,
    ///   or `variantSyntax` composition (base model + values validated
    ///   against the base model's controls). Unresolvable -> `UnknownModel`.
    /// - Availability beats visibility: the resolved base model must be
    ///   available under the active contexts (`ModelGated` otherwise), but
    ///   need not be `defaultVisible`.
    /// - No requested model -> curation default for the first active context
    ///   carrying one (`session.defaults`), else the first visible available
    ///   model in document order, else `None` (harness default) — defaults
    ///   never hard-fail.
    /// - Mode is validated against the resolved model's `mode` control when
    ///   the document carries one, else the agent-level `mode` control. An
    ///   agent with no mode vocabulary accepts no mode selection.
    pub fn validate_launch(
        &self,
        kind: &str,
        contexts: &ActiveAuthContexts,
        model_id: Option<&str>,
        mode_id: Option<&str>,
    ) -> Result<ResolvedSelection, SelectionUnsupported> {
        self.validate_launch_in_universe(
            kind,
            contexts,
            model_id,
            mode_id,
            &ObservedUniverse::empty(),
        )
    }

    /// [`ActiveCatalog::validate_launch`] against the machine's composed
    /// observation as well as the shipped catalog — the observation-first form
    /// the wired launch paths use.
    ///
    /// The universe changes what validation accepts in three ways:
    ///
    /// 1. a catalog model the observation carries is available even when
    ///    `availability.anyOf` predates the auth serving it — the observation is
    ///    the truth wherever it exists;
    /// 2. a model the catalog does not know at all, present in the observation,
    ///    resolves to itself — this is the case that makes a gateway-side model
    ///    add launchable on the day it appears, without a catalog release;
    /// 3. a model the catalog declares that the observation does NOT carry is
    ///    refused — the downgraded-key case, which is how the user gets a legible
    ///    pre-launch rejection instead of a provider 403 mid-session.
    ///    Trial-verified rows are exempt (see `universe.rs`).
    ///
    /// `UnknownModel` means "absent from the observation AND the catalog".
    /// `ModelGated`'s `required_contexts` is the catalog's `availability.anyOf`
    /// verbatim — curated unlock guidance, since the composed observation carries
    /// no per-context attribution. (The gated taxonomy itself is slated for
    /// deletion with the validation re-cut; until then the payload stays
    /// catalog-derived.)
    pub fn validate_launch_in_universe(
        &self,
        kind: &str,
        contexts: &ActiveAuthContexts,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        universe: &ObservedUniverse,
    ) -> Result<ResolvedSelection, SelectionUnsupported> {
        let agent = self
            .agent(kind)
            .ok_or_else(|| SelectionUnsupported::UnknownAgent {
                agent_kind: kind.to_string(),
            })?;

        let requested = model_id.map(str::trim).filter(|id| !id.is_empty());
        let resolved = match requested {
            Some(requested) => {
                let Some(resolved) = resolve_requested_model(agent, requested) else {
                    // Not in the catalog by any spelling. Before rejecting, ask the
                    // observation: the shipped catalog is a snapshot of a nightly
                    // probe, so a model the gateway or the provider added since is
                    // genuinely launchable and genuinely absent here.
                    return self.validate_observed_only_model(agent, requested, mode_id, universe);
                };
                if !model_is_available(resolved.model, contexts, universe) {
                    return Err(SelectionUnsupported::ModelGated {
                        requested_model_id: requested.to_string(),
                        canonical_model_id: resolved.model.id.clone(),
                        active_contexts: contexts.ids().to_vec(),
                        required_contexts: resolved.model.availability.any_of.clone(),
                        catalog_version: self.document.catalog_version.clone(),
                    });
                }
                Some(resolved)
            }
            None => default_model(agent, contexts, universe).map(|model| ResolvedModel {
                model,
                launch_id: model.id.clone(),
            }),
        };

        let mode_id = validate_mode(agent, resolved.as_ref().map(|r| r.model), mode_id)?;

        Ok(ResolvedSelection {
            model_id: resolved.as_ref().map(|r| r.model.id.clone()),
            launch_model_id: resolved.map(|r| r.launch_id),
            mode_id,
        })
    }

    /// A requested id the catalog does not carry, judged purely on observation.
    ///
    /// Its canonical id is the observed id itself: there is no catalog identity to
    /// normalize to, and inventing one would be the guessy name matching the
    /// enrichment join deliberately avoids. Mode validation falls through to the
    /// agent-level vocabulary, since no model row exists to carry a `mode` control.
    ///
    /// One question, one answer: the composed observation either carries the id
    /// (a launch right now would show it — resolve) or it does not (`UnknownModel`).
    /// There is no "observed under another context" middle state, because the
    /// observation has no contexts.
    fn validate_observed_only_model(
        &self,
        agent: &AgentCatalogAgent,
        requested: &str,
        mode_id: Option<&str>,
        universe: &ObservedUniverse,
    ) -> Result<ResolvedSelection, SelectionUnsupported> {
        if !universe.observes_id(requested) {
            return Err(SelectionUnsupported::UnknownModel {
                model_id: requested.to_string(),
            });
        }
        let mode_id = validate_mode(agent, None, mode_id)?;
        Ok(ResolvedSelection {
            model_id: Some(requested.to_string()),
            launch_model_id: Some(requested.to_string()),
            mode_id,
        })
    }
}


#[cfg(test)]
mod pin_identity_tests {
    use super::*;

    fn git_source(git_ref: &str) -> ResolvedPinSource {
        ResolvedPinSource::Git {
            repo: "https://github.com/proliferate-ai/claude-agent-acp.git".into(),
            git_ref: git_ref.into(),
            package_subdir: None,
            executable_relpath: "node_modules/.bin/claude-agent-acp".into(),
        }
    }

    #[test]
    fn git_sourced_pin_identity_is_the_commit_sha_not_the_display_version() {
        // Regression for the claude agent_process reinstall loop: the catalog
        // pin's declared "version" is a display label ("0.44.0"), but a
        // git-sourced install records the resolved commit sha as its
        // installed version (see managed_npm::npm_package_version's
        // non-registry-spec handling). Comparing the label against the sha
        // never converges, forcing a reinstall on every startup reconcile.
        let sha = "3ff484e671de5fe9275d2e7596d683df06b99e14";
        let source = git_source(sha);
        assert_eq!(
            pin_identity("0.44.0", Some(&source)),
            Some(sha.to_string())
        );
    }

    #[test]
    fn non_git_sourced_pin_identity_keeps_the_declared_label() {
        let source = ResolvedPinSource::Binary {
            targets: Default::default(),
        };
        assert_eq!(
            pin_identity("2.1.181", Some(&source)),
            Some("2.1.181".to_string())
        );
    }

    #[test]
    fn no_source_falls_back_to_declared_label() {
        assert_eq!(pin_identity("1.0.0", None), Some("1.0.0".to_string()));
    }

    #[test]
    fn placeholder_versions_are_not_usable_pins() {
        let source = git_source("");
        assert_eq!(pin_identity("unknown", Some(&source)), None);
        assert_eq!(pin_identity("", None), None);
    }
}
