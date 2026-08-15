//! Which harnesses the engine may probe.
//!
//! A seam rather than inline calls, for two reasons. It keeps the engine's
//! coalescing/backoff logic testable without a registry and a real install on
//! disk; and it puts the one policy carve-out in ONE place where it is visible
//! instead of scattered through the reconcile loop.
//!
//! The engine no longer iterates auth contexts: one composed observation per
//! harness, so a target is a harness, full stop.

use crate::domains::agents::model::AgentKind;
use crate::domains::agents::readiness::service::resolve_agent_unrouted;
use crate::domains::agents::registry::{built_in_registry, descriptor};
use std::path::PathBuf;

/// Harnesses excluded from every UNATTENDED probe.
///
/// Cursor's credential lives in the macOS Keychain, so an unattended `cursor-agent`
/// spawn can surface an OS keychain prompt with no user-visible cause. A manual
/// refresh is still allowed — the user asked, so a prompt has an obvious
/// explanation.
///
/// Enforced in ONE place, `poke_harness`, rather than per call site: the list used
/// to be consulted only by the whole-machine enumeration, so the pokes that name a
/// harness directly walked straight past it and spawned `cursor-agent` unattended.
const AUTO_PROBE_EXCLUDED_HARNESSES: &[AgentKind] = &[AgentKind::Cursor];

pub trait ProbeTargets: Send + Sync {
    /// Installed harnesses eligible for the automatic pokes.
    fn auto_harnesses(&self) -> Vec<String>;
    /// May an AUTOMATIC poke probe this harness at all?
    ///
    /// Separate from [`ProbeTargets::auto_harnesses`] because the two answer
    /// different questions: that one enumerates a whole-machine pass, this one judges
    /// a harness someone named. Only having the former is how cursor's law came to be
    /// bypassed by the poke sites that name a harness directly.
    fn allows_automatic_probe(&self, harness_kind: &str) -> bool;
    /// Is the harness's agent process installed? `probe_agent` bails without it,
    /// so the engine filters first rather than turning a missing install into a
    /// failed attempt the UI would render as a probe error.
    fn is_installed(&self, harness_kind: &str) -> bool;
}

/// Production: registry for the harness universe and `resolve_agent_unrouted` for
/// install state (the same fn `probe_agent` uses).
pub struct RuntimeProbeTargets {
    runtime_home: PathBuf,
}

impl RuntimeProbeTargets {
    pub fn new(runtime_home: PathBuf) -> Self {
        Self { runtime_home }
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
}
