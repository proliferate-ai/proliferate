//! Catalog-resolved gateway render inputs (spec §3).
//!
//! A [`GatewayModelPlan`] is the pure bundle of model values the gateway
//! renderers consume: the small-fast role pin (claude), the default model
//! (codex config.toml), and the explicit model list (opencode's models map).
//! It flows INTO `render_profile` already resolved — render/materialize never
//! look anything up, and the model-id constants that used to live in
//! `render.rs` are gone.
//!
//! The plan is produced by the catalog-domain resolver
//! (`agents::catalog::gateway_resolver`); this module only owns the shape and
//! the [`GatewayModelResolve`] seam so the render plane stays free of a
//! database/catalog dependency (and unit-testable with a stub resolver).

use std::path::Path;

/// Resolved gateway model inputs for one harness launch. Every field is a
/// pre-decided value: `None`/empty means "the harness has no such input"
/// (e.g. claude has no default-model override, only `small_fast_model`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GatewayModelPlan {
    /// The gateway default model id (codex requires it in config.toml). From
    /// `session.defaults["gateway"]`.
    pub default_model: Option<String>,
    /// The small/fast sidecar model id (claude only). From
    /// `gatewayPolicy.roles["small_fast"]`.
    pub small_fast_model: Option<String>,
    /// The explicit gateway model list (opencode's models map). Latest probe
    /// rows for (harness, revision) if present, else `gatewayPolicy.seedModels`,
    /// filtered by `gatewayPolicy.providers`.
    pub models: Vec<String>,
}

/// The seam the render plane calls to obtain a [`GatewayModelPlan`] for a
/// launch. Implemented by the catalog-domain resolver; render_tests use a
/// stub. `resolve_gateway_models` never fails (it degrades to seed/empty) so a
/// missing probe never blocks a launch.
pub trait GatewayModelResolve: Send + Sync {
    fn resolve_gateway_models(&self, harness_kind: &str, revision: i64) -> GatewayModelPlan;

    /// Launch-time lazy trigger (spec §2c): if no probe row exists yet for the
    /// current revision, schedule a background probe. MUST NOT block the launch
    /// (default: no-op, for stubs). The real resolver reads the gateway
    /// credentials from the state file under `runtime_home`.
    fn schedule_launch_probe_if_stale(&self, harness_kind: &str, runtime_home: &Path) {
        let _ = (harness_kind, runtime_home);
    }
}
