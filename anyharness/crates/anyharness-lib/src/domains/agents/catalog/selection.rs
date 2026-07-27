//! Resolving one launch selection against the catalog and the observed universe
//! (pure).
//!
//! Split out of [`super::service`] when launch validation grew its
//! snapshot-first universe: `service.rs` is the catalog READ surface (pins,
//! contexts, menus), and this is the one decision procedure that reads it. Every
//! function here is pure and takes what it needs, so the resolution ladder is
//! testable without a catalog service.
//!
//! The ladder, in order, is settled by model-catalog.md, "Launch validation":
//! exact id, then alias, then probe-observed variant id, then `variantSyntax`
//! composition — and availability is judged on the BASE model while the composed
//! id is preserved as the launch id.

use super::schema::{AgentCatalogAgent, AgentCatalogModel};
use super::service::SelectionUnsupported;
use super::universe::{is_trial_verified, ObservedUniverse};
use crate::domains::agents::auth::context::ActiveAuthContexts;
use crate::domains::agents::model::ModelCatalogStatus;

pub(super) struct ResolvedModel<'a> {
    pub(super) model: &'a AgentCatalogModel,
    pub(super) launch_id: String,
}

/// The observation is the truth wherever it exists (model-catalog.md, "Serving"):
/// with an observation, a model is available iff the composed observation carries
/// it — with the one trial-verified exemption, whose rows the harness never
/// advertises and which therefore stay catalog-governed. Without an observation
/// (pre-first-probe, machineless surfaces), the shipped catalog's per-context
/// declarations serve as the seed, exactly as before probing existed.
pub(super) fn model_is_available(
    model: &AgentCatalogModel,
    contexts: &ActiveAuthContexts,
    universe: &ObservedUniverse,
) -> bool {
    if universe.has_observation() {
        return universe.observes_model(model)
            || (is_trial_verified(model) && catalog_declares_available(model, contexts));
    }
    catalog_declares_available(model, contexts)
}

/// The seed rule: the shipped catalog declares the model under some ACTIVE auth
/// context. Auth contexts remain a SELECTION-side concept (which sources are
/// enabled); the observation side carries none.
pub(super) fn catalog_declares_available(
    model: &AgentCatalogModel,
    contexts: &ActiveAuthContexts,
) -> bool {
    model
        .availability
        .any_of
        .iter()
        .any(|context_id| contexts.is_active(context_id))
}

pub(super) fn find_model<'a>(
    agent: &'a AgentCatalogAgent,
    model_id: &str,
) -> Option<&'a AgentCatalogModel> {
    agent
        .session
        .models
        .iter()
        .find(|model| model.id == model_id)
        .or_else(|| {
            agent
                .session
                .models
                .iter()
                .find(|model| model.aliases.iter().any(|alias| alias == model_id))
        })
}

/// Resolve a requested model id: exact id -> alias -> probe-observed variant
/// id -> `variantSyntax` composition. The launch id preserves the variant
/// form; availability and controls are judged on the base model.
pub(super) fn resolve_requested_model<'a>(
    agent: &'a AgentCatalogAgent,
    requested: &str,
) -> Option<ResolvedModel<'a>> {
    if let Some(model) = find_model(agent, requested) {
        return Some(ResolvedModel {
            model,
            launch_id: model.id.clone(),
        });
    }

    if let Some(model) = agent.session.models.iter().find(|model| {
        model
            .provenance
            .as_ref()
            .is_some_and(|provenance| provenance.variant_ids.iter().any(|id| id == requested))
    }) {
        return Some(ResolvedModel {
            model,
            launch_id: requested.to_string(),
        });
    }

    compose_variant(agent, requested)
}

fn variant_syntax(agent: &AgentCatalogAgent) -> Option<&str> {
    agent
        .session
        .controls
        .iter()
        .find(|control| control.key == "model")
        .and_then(|control| control.mapping.as_ref())
        .and_then(|mapping| mapping.variant_syntax.as_deref())
}

/// Compose a variant launch id per the agent's declared `variantSyntax`.
/// Each composed value must be supported by the base model's controls.
fn compose_variant<'a>(agent: &'a AgentCatalogAgent, requested: &str) -> Option<ResolvedModel<'a>> {
    match variant_syntax(agent)? {
        // `<base>/<effort>` (codex): effort validated against the model's
        // reasoning-effort control (key "reasoning_effort", or "effort").
        "slash-effort" => {
            let (base, effort) = requested.rsplit_once('/')?;
            let model = find_model(agent, base)?;
            let control = model
                .controls
                .get("reasoning_effort")
                .or_else(|| model.controls.get("effort"))?;
            control
                .values
                .iter()
                .any(|value| value == effort)
                .then(|| ResolvedModel {
                    model,
                    launch_id: requested.to_string(),
                })
        }
        // `<base>[k=v,...]` (cursor): every pair must be a control the model
        // declares with that value; empty brackets compose trivially.
        "bracket-params" => {
            let inner = requested.strip_suffix(']')?;
            let (base, params) = inner.split_once('[')?;
            let model = find_model(agent, base)?;
            let supported = params
                .split(',')
                .filter(|pair| !pair.is_empty())
                .all(|pair| {
                    pair.split_once('=').is_some_and(|(key, value)| {
                        model
                            .controls
                            .get(key)
                            .is_some_and(|control| control.values.iter().any(|v| v == value))
                    })
                });
            supported.then(|| ResolvedModel {
                model,
                launch_id: requested.to_string(),
            })
        }
        other => {
            tracing::debug!(syntax = other, "unknown variantSyntax; no composition");
            None
        }
    }
}

/// Default model when none was requested: curation default for the first
/// active context that has one (and is available), else the first visible
/// available model in document order. `None` is a valid outcome.
pub(super) fn default_model<'a>(
    agent: &'a AgentCatalogAgent,
    contexts: &ActiveAuthContexts,
    universe: &ObservedUniverse,
) -> Option<&'a AgentCatalogModel> {
    for context_id in contexts.ids() {
        let Some(default_id) = agent.session.defaults.get(context_id) else {
            continue;
        };
        if let Some(model) = find_model(agent, default_id) {
            if model_is_available(model, contexts, universe) {
                return Some(model);
            }
        }
    }
    agent.session.models.iter().find(|model| {
        model.default_visible
            && model.status == ModelCatalogStatus::Active
            && model_is_available(model, contexts, universe)
    })
}

/// Mode validation ladder: model `mode` control -> agent-level `mode`
/// control. No vocabulary means no mode selection is accepted.
pub(super) fn validate_mode(
    agent: &AgentCatalogAgent,
    model: Option<&AgentCatalogModel>,
    mode_id: Option<&str>,
) -> Result<Option<String>, SelectionUnsupported> {
    let Some(mode_id) = mode_id.map(str::trim).filter(|id| !id.is_empty()) else {
        return Ok(None);
    };
    let unsupported = || SelectionUnsupported::UnsupportedMode {
        mode_id: mode_id.to_string(),
    };

    if let Some(control) = model.and_then(|model| model.controls.get("mode")) {
        if !control.values.is_empty() {
            return control
                .values
                .iter()
                .any(|value| value == mode_id)
                .then(|| Some(mode_id.to_string()))
                .ok_or_else(unsupported);
        }
    }

    let Some(control) = agent
        .session
        .controls
        .iter()
        .find(|control| control.key == "mode" && !control.values.is_empty())
    else {
        return Err(unsupported());
    };
    control
        .values
        .iter()
        .any(|value| value == mode_id)
        .then(|| Some(mode_id.to_string()))
        .ok_or_else(unsupported)
}
