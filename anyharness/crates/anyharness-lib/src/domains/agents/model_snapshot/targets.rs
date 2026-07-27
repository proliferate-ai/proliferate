//! Which (harness, auth context) pairs the engine may probe.
//!
//! A seam rather than inline calls, for two reasons. It keeps the engine's
//! coalescing/backoff/gate logic testable without a registry, a catalog document
//! and a real install on disk; and it puts the two policy carve-outs in ONE place
//! where they are visible instead of scattered through the reconcile loop.

use crate::domains::agents::auth::context::classify;
use crate::domains::agents::auth::launch_facts::collect_launch_env_facts;
use crate::domains::agents::catalog::schema::AgentCatalogAuthContext;
use crate::domains::agents::catalog::service::AgentCatalogService;
use crate::domains::agents::model::AgentKind;
use crate::domains::agents::readiness::service::resolve_agent_unrouted;
use crate::domains::agents::registry::{built_in_registry, descriptor};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Harnesses excluded from every UNATTENDED probe.
///
/// Cursor is keychain-only: `cursor-agent` ignores `CURSOR_API_KEY` and reads the
/// macOS Keychain, so an unattended spawn can surface an OS keychain prompt with
/// no user-visible cause. A manual refresh is still allowed — the user asked, so
/// a prompt has an obvious explanation.
///
/// Enforced in ONE place, `poke_harness`, rather than per call site: the list used
/// to be consulted only by the whole-machine enumeration, so the four pokes that
/// name a harness directly (install completed, install endpoint, auth applied,
/// session launch) walked straight past it.
const AUTO_PROBE_EXCLUDED_HARNESSES: &[AgentKind] = &[AgentKind::Cursor];

pub trait ProbeTargets: Send + Sync {
    /// Installed harnesses eligible for the automatic pokes.
    fn auto_harnesses(&self) -> Vec<String>;
    /// May an AUTOMATIC poke probe this harness at all?
    ///
    /// Separate from [`ProbeTargets::auto_harnesses`] because the two answer
    /// different questions: that one enumerates a whole-machine pass, this one judges
    /// a harness someone named. Only having the former is how cursor's law came to be
    /// bypassed by four of the six poke sites — every site that names a harness
    /// directly skipped the enumeration entirely.
    fn allows_automatic_probe(&self, harness_kind: &str) -> bool;
    /// The active auth contexts for a harness, in catalog order.
    fn active_contexts(&self, harness_kind: &str) -> Vec<String>;
    /// Is the harness's agent process installed? `probe_agent` bails without it,
    /// so the engine filters first rather than turning a missing install into a
    /// failed attempt the UI would render as a probe error.
    fn is_installed(&self, harness_kind: &str) -> bool;
    /// The harness's catalog `authContexts`, needed by phase A to scope a source
    /// list down to one context.
    fn catalog_contexts(&self, harness_kind: &str) -> Vec<AgentCatalogAuthContext>;
}

/// Production: registry for the harness universe, `resolve_agent_unrouted` for
/// install state (the same fn `probe_agent` uses), the catalog for context
/// declarations, and the pure classifier for which of them are active.
pub struct RuntimeProbeTargets {
    runtime_home: PathBuf,
    catalog: AgentCatalogService,
}

impl RuntimeProbeTargets {
    pub fn new(runtime_home: PathBuf, catalog: AgentCatalogService) -> Self {
        Self {
            runtime_home,
            catalog,
        }
    }
}

impl ProbeTargets for RuntimeProbeTargets {
    fn auto_harnesses(&self) -> Vec<String> {
        built_in_registry()
            .iter()
            .map(|descriptor| descriptor.kind.as_str().to_string())
            .filter(|kind| self.allows_automatic_probe(kind))
            .filter(|kind| self.is_installed(kind))
            .collect()
    }

    fn allows_automatic_probe(&self, harness_kind: &str) -> bool {
        !AUTO_PROBE_EXCLUDED_HARNESSES
            .iter()
            .any(|excluded| excluded.as_str() == harness_kind)
    }

    fn active_contexts(&self, harness_kind: &str) -> Vec<String> {
        let Some(descriptor) = descriptor(harness_kind) else {
            return Vec::new();
        };
        let contexts = self.catalog_contexts(harness_kind);
        if contexts.is_empty() {
            return Vec::new();
        }
        // Host-ambient env: a probe is not scoped to a workspace, so the machine's
        // own environment is the honest input — the same view the settings read
        // surface classifies against.
        let facts = collect_launch_env_facts(harness_kind, &BTreeMap::new(), &self.runtime_home);
        classify(&descriptor, &contexts, &facts).ids().to_vec()
    }

    fn is_installed(&self, harness_kind: &str) -> bool {
        descriptor(harness_kind)
            .map(|descriptor| {
                resolve_agent_unrouted(&descriptor, &self.runtime_home)
                    .agent_process
                    .path
                    .is_some()
            })
            .unwrap_or(false)
    }

    fn catalog_contexts(&self, harness_kind: &str) -> Vec<AgentCatalogAuthContext> {
        self.catalog
            .active_catalog()
            .agents()
            .iter()
            .find(|agent| agent.kind == harness_kind)
            .map(|agent| agent.auth_contexts.clone())
            .unwrap_or_default()
    }
}
