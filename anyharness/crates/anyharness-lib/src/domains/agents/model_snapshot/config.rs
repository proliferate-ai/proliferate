//! The engine's tunables, its poke vocabulary, its ownership mode, and the one
//! error a forced refresh can produce.
//!
//! Split out of `mod.rs` so the reconciler file holds only the reconciler. Every
//! default here carries the reason it was chosen; none is arbitrary.

use std::time::Duration;

use super::probe::ProbeError;
use super::staleness;
use crate::domains::agents::route_auth::RouteAuthError;

/// Why a poke fired. Diagnostics only — the gate, never the reason, decides
/// whether a probe happens. That is precisely what makes invalidation "exactly as
/// wide as the change" instead of as wide as the trigger.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PokeReason {
    Startup,
    InstallCompleted,
    AuthApplied,
    AuthCleared,
    SessionLaunch,
    Manual,
}

impl PokeReason {
    /// Was this poke raised by a user asking for it, right now?
    ///
    /// The one policy that turns on this distinction is cursor's
    /// manual-refresh-only law (model-catalog.md, "Cursor is manual-refresh only"):
    /// an unattended `cursor-agent` spawn can surface an OS keychain prompt with no
    /// user-visible cause, whereas a prompt the user just asked for explains itself.
    /// Everything else about a poke is decided by the staleness gate, deliberately —
    /// the reason is diagnostics.
    pub fn is_user_initiated(self) -> bool {
        matches!(self, Self::Manual)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Startup => "startup",
            Self::InstallCompleted => "install_completed",
            Self::AuthApplied => "auth_applied",
            Self::AuthCleared => "auth_cleared",
            Self::SessionLaunch => "session_launch",
            Self::Manual => "manual",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProbeEngineConfig {
    /// Hard bound on one attempt. `probe_agent` carries none of its own.
    pub per_probe_timeout: Duration,
    /// Documents intent only: the field it feeds is never read by
    /// `run_enumeration` today.
    pub model_switch_timeout: Duration,
    /// The anti-storm floor: an attempt that COMPLETED (either outcome) inside
    /// this window is never retried by an automatic poke.
    pub min_reprobe_interval: Duration,
    pub ttl_base: Duration,
    pub ttl_jitter_span: Duration,
    /// First failure waits this long; each subsequent failure doubles it.
    pub backoff_base: Duration,
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
            per_probe_timeout: Duration::from_secs(240),
            model_switch_timeout: Duration::from_secs(10),
            min_reprobe_interval: Duration::from_secs(60),
            ttl_base: staleness::DEFAULT_TTL_BASE,
            ttl_jitter_span: staleness::DEFAULT_TTL_JITTER_SPAN,
            backoff_base: Duration::from_secs(60),
            backoff_max: Duration::from_secs(6 * 60 * 60),
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
    #[error("no active auth context '{auth_context_id}' for harness '{harness_kind}'")]
    UnknownContext {
        harness_kind: String,
        auth_context_id: String,
    },
    #[error("harness '{0}' is not installed")]
    NotInstalled(String),
    #[error(transparent)]
    Probe(#[from] ProbeError),
}

impl RefreshError {
    /// The stable machine code the transport layer surfaces.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotOwner => "PROBE_ENGINE_NOT_OWNER",
            Self::Material(_) => "MODEL_SNAPSHOT_MATERIAL_FAILED",
            Self::UnknownContext { .. } => "MODEL_SNAPSHOT_UNKNOWN_CONTEXT",
            Self::NotInstalled(_) => "MODEL_SNAPSHOT_NOT_INSTALLED",
            Self::Probe(_) => "MODEL_SNAPSHOT_PROBE_FAILED",
        }
    }
}
