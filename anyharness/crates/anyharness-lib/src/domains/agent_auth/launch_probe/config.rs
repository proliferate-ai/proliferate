//! The engine's tunables, its poke vocabulary, its ownership mode, and the one
//! error a forced refresh can produce.
//!
//! Split out of `mod.rs` so the reconciler file holds only the reconciler. Every
//! default here carries the reason it was chosen; none is arbitrary.

use std::time::Duration;

use super::probe::ProbeError;
use crate::domains::agent_auth::route_auth::RouteAuthError;

/// Why a poke fired. **This is the closed event-driven trigger set**: the
/// unconditional startup pass, auth apply, install completion, login-terminal
/// exit, live contradiction, manual refresh, backoff expiry, and first
/// detection. There is no poll — a poke probes, subject only to the engine's
/// concurrency guards and the failure backoff. The set contains its own
/// recovery (spec §3 flow 4): a missed probe re-enters through
/// [`Self::BackoffExpired`], not through a human.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PokeReason {
    /// The unconditional startup pass — the safety net that catches everything
    /// that happened while the runtime was down or that had no event.
    Startup,
    InstallCompleted,
    /// An applied `state.json` change. The apply site computes the per-harness
    /// changed set and pokes ONLY those harnesses (a clear names every harness
    /// the previous document carried).
    AuthApplied,
    /// A native login performed through the product's login terminal ended.
    LoginTerminal,
    /// A real session contradicted the target observation that admitted its
    /// immutable launch intent.
    LiveContradiction,
    Manual,
    /// A failed attempt's backoff window lapsed — the engine's self-recovery.
    /// Armed by `record_failure`'s one-shot timer; retries exactly the harness
    /// whose backoff expired, with no human in the loop.
    BackoffExpired,
    /// The status module's startup pass found an installed, auto-probeable
    /// harness with no persisted status row — a harness that appeared without
    /// an install event.
    FirstDetected,
}

impl PokeReason {
    /// May this event re-observe a manual-refresh-only harness? A live
    /// contradiction is tied to a real session the product already launched,
    /// so it must repair that target even when routine unattended pokes are
    /// suppressed. Neither recovery event qualifies: cursor stays manual-only.
    pub fn allows_manual_refresh_only_harness(self) -> bool {
        matches!(self, Self::LiveContradiction | Self::Manual)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Startup => "startup",
            Self::InstallCompleted => "install_completed",
            Self::AuthApplied => "auth_applied",
            Self::LoginTerminal => "login_terminal",
            Self::LiveContradiction => "live_contradiction",
            Self::Manual => "manual",
            Self::BackoffExpired => "backoff_expired",
            Self::FirstDetected => "first_detected",
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
