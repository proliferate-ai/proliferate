//! The ONE read surface over the ACTIVE agent catalog (migration §5.3).
//!
//! Every runtime consumer of catalog v2 data goes through here: installer
//! pins, model menus, control matrices, and launch validation. The dual-era
//! gate is [`AgentCatalogService::active_v2`]: it returns a snapshot only
//! when the active catalog is a v2 document — `None` IS the "stay on the v1
//! path" signal, so v1 behavior is untouched by construction.
//!
//! Semantic rules (decisions ledger 9, §5.3):
//! - `defaultVisible` is the menu, `availability` is the truth:
//!   [`ActiveV2Catalog::validate_launch`] accepts launchable-but-unadvertised
//!   models (available under the active contexts but not default-visible).
//! - Availability is the observed set: a model is available iff
//!   `availability.anyOf` intersects the active context ids — `"baseline"`
//!   counts like any other context when it is active.
//! - Models are entities, never modes; variant launch ids (`variantSyntax`)
//!   resolve to their base model for availability and control checks while
//!   the composed variant id is preserved as the launch id.

use std::collections::BTreeMap;
use std::sync::Arc;

use super::loader::AgentCatalog;
use super::schema_v2::{
    AgentCatalogV2Agent, AgentCatalogV2AuthContext, AgentCatalogV2HarnessPins,
    AgentCatalogV2Model, AgentCatalogV2ModelControl,
};
use super::sync::CatalogSyncService;
use crate::domains::agents::auth::context::ActiveAuthContexts;
use crate::domains::agents::catalog::projection::models::bundled_create_mode_ids;
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

    /// Snapshot of the active catalog when it is a v2 document; `None` in
    /// the v1 era (consumers then keep their existing v1 paths, untouched).
    /// Catalog pin overrides for the installer (None when no v2 catalog is
    /// active or the kind is unknown to it).
    pub fn pin_overrides(
        &self,
        kind: &str,
    ) -> Option<crate::domains::agents::installer::install_policy::PinOverrides> {
        let active = self.active_v2()?;
        let pins = active.pins(kind)?;
        // Placeholder pins ("unknown" — e.g. cursor pre manifest-provenance)
        // must not drive drift: an unknowable pin is no pin.
        let usable = |version: &str| {
            (!version.is_empty() && version != "unknown").then(|| version.to_string())
        };
        Some(crate::domains::agents::installer::install_policy::PinOverrides {
            agent_process: usable(&pins.agent_process.version),
            native: pins.native.as_ref().and_then(|pin| usable(&pin.version)),
        })
    }

    pub fn active_v2(&self) -> Option<ActiveV2Catalog> {
        ActiveV2Catalog::from_catalog(self.sync.active().document)
    }
}

/// A pinned v2 catalog snapshot: readers borrow from it for as long as they
/// hold it, and keep a consistent document across concurrent sync swaps.
#[derive(Debug, Clone)]
pub struct ActiveV2Catalog {
    document: Arc<AgentCatalog>,
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
    /// `required_contexts` is `availability.anyOf` — the unlock condition.
    ModelGated {
        model_id: String,
        required_contexts: Vec<String>,
    },
    UnsupportedMode {
        mode_id: String,
    },
}

impl ActiveV2Catalog {
    /// Wrap a catalog snapshot iff it is a v2 document.
    pub fn from_catalog(document: Arc<AgentCatalog>) -> Option<Self> {
        match document.as_ref() {
            AgentCatalog::V2(_) => Some(Self { document }),
            AgentCatalog::V1(_) => None,
        }
    }

    fn agents(&self) -> &[AgentCatalogV2Agent] {
        match self.document.as_ref() {
            AgentCatalog::V2(document) => &document.agents,
            // Unreachable by construction (`from_catalog` only admits V2).
            AgentCatalog::V1(_) => &[],
        }
    }

    pub fn agent(&self, kind: &str) -> Option<&AgentCatalogV2Agent> {
        self.agents().iter().find(|agent| agent.kind == kind)
    }

    /// Harness version pins for the kind (installer + readiness drift).
    pub fn pins(&self, kind: &str) -> Option<&AgentCatalogV2HarnessPins> {
        self.agent(kind).map(|agent| &agent.harness)
    }

    /// The agent's ordered auth-context signatures (classifier input).
    pub fn auth_contexts(&self, kind: &str) -> Option<&[AgentCatalogV2AuthContext]> {
        self.agent(kind).map(|agent| agent.auth_contexts.as_slice())
    }

    /// Models available under the active contexts: `availability.anyOf`
    /// intersected with the active ids (`"baseline"` counts when active).
    pub fn models(
        &self,
        kind: &str,
        contexts: &ActiveAuthContexts,
    ) -> Vec<&AgentCatalogV2Model> {
        let Some(agent) = self.agent(kind) else {
            return Vec::new();
        };
        agent
            .session
            .models
            .iter()
            .filter(|model| model_is_available(model, contexts))
            .collect()
    }

    /// The menu: `defaultVisible` ∩ available ∩ active-status.
    pub fn visible_models(
        &self,
        kind: &str,
        contexts: &ActiveAuthContexts,
    ) -> Vec<&AgentCatalogV2Model> {
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
    ) -> Option<&BTreeMap<String, AgentCatalogV2ModelControl>> {
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
    ///   the v2 document carries one, else the agent-level `mode` control,
    ///   else the bundled v1 create-mode ids (existing behavior).
    pub fn validate_launch(
        &self,
        kind: &str,
        contexts: &ActiveAuthContexts,
        model_id: Option<&str>,
        mode_id: Option<&str>,
    ) -> Result<ResolvedSelection, SelectionUnsupported> {
        let agent = self
            .agent(kind)
            .ok_or_else(|| SelectionUnsupported::UnknownAgent {
                agent_kind: kind.to_string(),
            })?;

        let requested = model_id.map(str::trim).filter(|id| !id.is_empty());
        let resolved = match requested {
            Some(requested) => {
                let resolved = resolve_requested_model(agent, requested).ok_or_else(|| {
                    SelectionUnsupported::UnknownModel {
                        model_id: requested.to_string(),
                    }
                })?;
                if !model_is_available(resolved.model, contexts) {
                    return Err(SelectionUnsupported::ModelGated {
                        model_id: requested.to_string(),
                        required_contexts: resolved.model.availability.any_of.clone(),
                    });
                }
                Some(resolved)
            }
            None => default_model(agent, contexts).map(|model| ResolvedModel {
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
}

struct ResolvedModel<'a> {
    model: &'a AgentCatalogV2Model,
    launch_id: String,
}

fn model_is_available(model: &AgentCatalogV2Model, contexts: &ActiveAuthContexts) -> bool {
    model
        .availability
        .any_of
        .iter()
        .any(|context_id| contexts.is_active(context_id))
}

fn find_model<'a>(
    agent: &'a AgentCatalogV2Agent,
    model_id: &str,
) -> Option<&'a AgentCatalogV2Model> {
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
fn resolve_requested_model<'a>(
    agent: &'a AgentCatalogV2Agent,
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

fn variant_syntax(agent: &AgentCatalogV2Agent) -> Option<&str> {
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
fn compose_variant<'a>(
    agent: &'a AgentCatalogV2Agent,
    requested: &str,
) -> Option<ResolvedModel<'a>> {
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
            let supported = params.split(',').filter(|pair| !pair.is_empty()).all(|pair| {
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
fn default_model<'a>(
    agent: &'a AgentCatalogV2Agent,
    contexts: &ActiveAuthContexts,
) -> Option<&'a AgentCatalogV2Model> {
    for context_id in contexts.ids() {
        let Some(default_id) = agent.session.defaults.get(context_id) else {
            continue;
        };
        if let Some(model) = find_model(agent, default_id) {
            if model_is_available(model, contexts) {
                return Some(model);
            }
        }
    }
    agent
        .session
        .models
        .iter()
        .find(|model| {
            model.default_visible
                && model.status == ModelCatalogStatus::Active
                && model_is_available(model, contexts)
        })
}

/// Mode validation ladder: model `mode` control -> agent-level `mode`
/// control -> bundled v1 create-mode ids (the pre-v2 surface).
fn validate_mode(
    agent: &AgentCatalogV2Agent,
    model: Option<&AgentCatalogV2Model>,
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

    if let Some(control) = agent
        .session
        .controls
        .iter()
        .find(|control| control.key == "mode" && !control.values.is_empty())
    {
        return control
            .values
            .iter()
            .any(|value| value == mode_id)
            .then(|| Some(mode_id.to_string()))
            .ok_or_else(unsupported);
    }

    let bundled = bundled_create_mode_ids(&agent.kind).unwrap_or_default();
    bundled
        .iter()
        .any(|valid| valid == mode_id)
        .then(|| Some(mode_id.to_string()))
        .ok_or_else(unsupported)
}
