//! Which harnesses the engine may probe.
//!
//! A seam rather than inline calls, for two reasons. It keeps the engine's
//! coalescing/backoff logic testable without a registry and a real install on
//! disk; and it puts the one policy carve-out in ONE place where it is visible
//! instead of scattered through the reconcile loop.
//!
//! The engine no longer iterates auth contexts: one composed observation per
//! harness, so a target is a harness, full stop.

use crate::domains::agents::model::{AgentKind, CredentialState};
use crate::domains::agents::readiness::service::resolve_agent_unrouted;
use crate::domains::agents::registry::{built_in_registry, descriptor};
use crate::domains::agents::route_auth::launch_route_provides_credentials;
use std::path::{Path, PathBuf};

/// Harnesses excluded from every UNATTENDED probe.
///
/// Cursor is keychain-only: `cursor-agent` ignores `CURSOR_API_KEY` and reads the
/// macOS Keychain, so an unattended spawn can surface an OS keychain prompt with
/// no user-visible cause. A manual refresh is still allowed — the user asked, so
/// a prompt has an obvious explanation.
///
/// Enforced in ONE place, `poke_harness`, rather than per call site: the list used
/// to be consulted only by the whole-machine enumeration, so the pokes that name a
/// harness directly walked straight past it and spawned `cursor-agent` unattended.
const AUTO_PROBE_EXCLUDED_HARNESSES: &[AgentKind] = &[AgentKind::Cursor];

/// May an unattended probe spawn Grok? Only when its composed launch world —
/// native login, ambient `XAI_API_KEY`/`GROK_API_KEY`, or an enrolled
/// agent-auth route — holds credentials.
///
/// Grok's ACP `authenticate` is mandatory before `session/new` (which
/// otherwise fails "Authentication required"), and its one advertised method,
/// `grok.com`, resolves inline against whatever credentials exist. When NONE
/// exist it instead starts a browser OIDC device-code sign-in as a side effect
/// of the `authenticate` call itself, so an unattended spawn pops an
/// accounts.x.ai page with no user-visible cause and hangs the probe to its
/// timeout (PRO-210). Cursor's law, conditioned on credentials instead of
/// unconditional: a credentialed Grok converges automatically, and a manual
/// refresh still probes — the user asked, so a sign-in page explains itself.
///
/// The two arms mirror `apply_launch_route_upgrade` (readiness/service.rs):
/// host-scoped credential detection, absorbed route. Install state is
/// deliberately not consulted — `poke_harness` gates on that separately.
fn grok_probe_world_has_credentials(runtime_home: &Path) -> bool {
    let Some(descriptor) = descriptor(AgentKind::Grok.as_str()) else {
        return false;
    };
    matches!(
        resolve_agent_unrouted(&descriptor, runtime_home).credential_state,
        CredentialState::Ready | CredentialState::ReadyViaLocalAuth
    ) || launch_route_provides_credentials(runtime_home, descriptor.kind.as_str())
}

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
        if AUTO_PROBE_EXCLUDED_HARNESSES
            .iter()
            .any(|excluded| excluded.as_str() == harness_kind)
        {
            return false;
        }
        if harness_kind == AgentKind::Grok.as_str() {
            return grok_probe_world_has_credentials(&self.runtime_home);
        }
        true
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
