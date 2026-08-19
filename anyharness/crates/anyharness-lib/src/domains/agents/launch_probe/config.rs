//! The engine's tunables, its poke vocabulary, its ownership mode, and the one
//! error a forced refresh can produce.
//!
//! Split out of `mod.rs` so the reconciler file holds only the reconciler. Every
//! default here carries the reason it was chosen; none is arbitrary.

use std::time::Duration;

use super::probe::ProbeError;
use crate::domains::agents::route_auth::RouteAuthError;

/// Why a poke fired. **This is the closed trigger set** (model-catalog.md,
/// "Freshness is event-driven"): the unconditional startup pass, the auth-apply
/// ack, install completed, login-terminal exit, and manual refresh. There is no
/// poll, no timer, and no gate-triggered spawn — a poke probes, subject only to
/// the engine's concurrency guards and the failure backoff.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PokeReason {
    /// The unconditional startup pass — the safety net that catches everything
    /// that happened while the runtime was down or that had no event.
    Startup,
    InstallCompleted,
    /// An applied `state.json` (including a clear, which is the widest possible
    /// apply: it removes every harness's selection).
    AuthApplied,
    /// A native login performed through the product's login terminal ended.
    LoginTerminal,
    Manual,
}

impl PokeReason {
    /// Was this poke raised by a user asking for it, right now?
    ///
    /// The one policy that turns on this distinction is cursor's
    /// manual-refresh-only law (model-catalog.md, "Cursor is manual-refresh only"):
    /// an unattended `cursor-agent` spawn can surface an OS keychain prompt with no
    /// user-visible cause, whereas a prompt the user just asked for explains itself.
    pub fn is_user_initiated(self) -> bool {
        matches!(self, Self::Manual)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Startup => "startup",
            Self::InstallCompleted => "install_completed",
            Self::AuthApplied => "auth_applied",
            Self::LoginTerminal => "login_terminal",
            Self::Manual => "manual",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProbeEngineConfig {
    /// Hard bound on one attempt. `probe_agent` carries none of its own. Retuned
    /// (ADR FR-2, A5) from 240s to 45s: a healthy harness answers ACP `initialize`
    /// in well under a second, so a probe still running after 45s is stuck, not
    /// slow, and a shorter ceiling turns a wedged spawn into a fast failed attempt
    /// the backoff can then space out. A genuine spawn failure fast-fails long
    /// before this bound is reached (see [`super::probe::ProbeError::Spawn`]).
    pub per_probe_timeout: Duration,
    /// First failure waits this long before another AUTOMATIC poke may retry;
    /// each subsequent failure doubles it. Failure-only: a successful probe arms
    /// nothing, and a manual refresh bypasses the window.
    pub backoff_base: Duration,
    /// Ceiling on the doubling ladder. Retuned (ADR FR-2, A5) from 6h to 30min:
    /// the failures this brakes are transient (a provider blip, a mid-rotation
    /// key), and a half-hour ceiling recovers a self-healed harness within one
    /// window instead of leaving it dark for hours, while still bounding the
    /// spawn rate of a hard-down harness.
    pub backoff_max: Duration,
    /// Machine-wide concurrent probes. 1 by default: each probe spawns a real
    /// harness process, far heavier than the `gh` calls `pr_status_cache` caps
    /// at 2.
    pub max_concurrent_probes: usize,
    /// How long an orphan scratch must be untouched before the sweep may remove
    /// it, expressed as a multiple of `per_probe_timeout`.
    pub sweep_age_multiplier: u32,
}

impl Default for ProbeEngineConfig {
    fn default() -> Self {
        Self {
            per_probe_timeout: Duration::from_secs(45),
            backoff_base: Duration::from_secs(60),
            backoff_max: Duration::from_secs(30 * 60),
            max_concurrent_probes: 1,
            sweep_age_multiplier: 3,
        }
    }
}

/// Whether this runtime owns the probe engine for its home.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeEngineMode {
    Owner,
    ReadOnly,
}

impl ProbeEngineMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::ReadOnly => "readonly",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RefreshError {
    #[error("this runtime does not own the probe engine for its runtime home")]
    NotOwner,
    #[error("the probe could not be prepared: {0}")]
    Material(#[from] RouteAuthError),
    #[error("harness '{0}' is not installed")]
    NotInstalled(String),
    #[error(transparent)]
    Probe(#[from] ProbeError),
    #[error("launch-options persistence failed: {0}")]
    Persistence(String),
}

impl RefreshError {
    /// The stable machine code the transport layer surfaces.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotOwner => "PROBE_ENGINE_NOT_OWNER",
            Self::Material(_) => "LAUNCH_OPTIONS_MATERIAL_FAILED",
            Self::NotInstalled(_) => "LAUNCH_OPTIONS_NOT_INSTALLED",
            Self::Probe(_) => "LAUNCH_OPTIONS_PROBE_FAILED",
            Self::Persistence(_) => "LAUNCH_OPTIONS_PERSISTENCE_FAILED",
        }
    }
}
