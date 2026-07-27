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

/// Resolved gateway model inputs for one harness launch. Every field is a
/// pre-decided value: `None`/empty means "the harness has no such input"
/// (e.g. claude has no default-model override, only `small_fast_model`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GatewayModelPlan {
    /// The gateway default model id (codex requires it in config.toml). From
    /// `session.defaults["gateway"]`.
    pub default_model: Option<String>,
    /// The default model id for a NATIVE launch of this harness, i.e. the user's
    /// own provider login rather than the gateway. Codex needs it in its
    /// `config.toml` exactly as the gateway route does; the difference is only
    /// which catalog default it comes from.
    ///
    /// Resolved from `session.defaults` in auth-context precedence order
    /// (`openai-oauth` before `openai-api`), so the model is a catalog fact.
    /// A Rust constant here would be the model-name-in-code violation this
    /// field exists to remove.
    pub native_default_model: Option<String>,
    /// The default model id for a `provider_config` × `aws_bedrock` launch
    /// (Track D). From `session.defaults["bedrock"]` — deliberately its own
    /// catalog key, NOT `native_default_model`: the native precedence chain
    /// explicitly excludes `bedrock`/`azure` contexts (their defaults belong
    /// to the typed provider-config route, not to "the user's own login" —
    /// see `gateway_resolver.rs`'s `NATIVE_CONTEXT_PRECEDENCE` doc comment),
    /// and for codex specifically `native_default_model` resolves to an
    /// OpenAI-native id that is invalid on Bedrock.
    pub bedrock_default_model: Option<String>,
    /// The small/fast sidecar model id (claude only). From
    /// `gatewayPolicy.roles["small_fast"]`.
    pub small_fast_model: Option<String>,
    /// The explicit gateway model list (opencode's models map). Latest probe
    /// rows for (harness, revision) if present, else `gatewayPolicy.seedModels`.
    pub models: Vec<String>,
}

/// The seam the render plane calls to obtain a [`GatewayModelPlan`] for a
/// launch. Implemented by the catalog-domain planner; render_tests use a stub.
/// `resolve_gateway_models` never fails (it degrades to a seed floor) so a
/// missing plan never blocks a launch.
///
/// Materialization only. The trait used to carry a
/// `schedule_launch_probe_if_stale` trigger too, which is gone: launch-time
/// re-observation is now a poke of the general model-snapshot reconciler, whose
/// staleness gate is per (harness, auth context) rather than per gateway revision.
/// A seam that both supplies render input AND scheduled its own background work
/// meant every stub implementor silently inherited a no-op trigger.
pub trait GatewayModelResolve: Send + Sync {
    fn resolve_gateway_models(&self, harness_kind: &str, revision: i64) -> GatewayModelPlan;

    /// Drop any memoized gateway model list for `harness_kind`, so the next
    /// resolve genuinely re-asks the gateway.
    ///
    /// A user pressing Refresh usually did so BECAUSE the gateway's model set
    /// changed, and a memo would serve them the pre-change list labelled
    /// "refreshed just now".
    ///
    /// Default no-op, which is the CORRECT behavior for today's producer: it reads
    /// the `gateway_model_probe` sqlite rows, so there is no in-process memo to
    /// invalidate. The memoizing producer that makes this call load-bearing lands
    /// with the poke wiring; the seam exists now so the probe engine's forced-
    /// refresh path is already correct when it does.
    fn invalidate_gateway_plan(&self, harness_kind: &str) {
        let _ = harness_kind;
    }

    /// A plan for a PROBE, on a caller that has declared it may block.
    ///
    /// Two callers, two rules, one trait: a launch must never wait on the network
    /// (it renders inline on the spawn path), while a probe is a background
    /// convergence action that is about to spawn a whole harness — waiting a few
    /// seconds for the model list it is going to observe is exactly the right trade.
    /// Without the split, either every launch could stall on an unreachable gateway
    /// or every probe would observe a stale plan.
    ///
    /// Returns the plan plus whether it came from a seed FLOOR rather than a live
    /// list. The flag is not cosmetic: a floor-derived plan makes the resulting
    /// observation a tautology (the harness reports back the ids the plan just wrote
    /// into its config), so the entry records a warning instead of passing it off as
    /// a discovery.
    ///
    /// Default: whatever the non-blocking resolve returns, flagged as not-a-floor —
    /// correct for every stub, since a stub's plan is fixed data and cannot degrade.
    fn resolve_gateway_models_blocking(
        &self,
        harness_kind: &str,
        revision: i64,
    ) -> (GatewayModelPlan, bool) {
        (self.resolve_gateway_models(harness_kind, revision), false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The trait's surface, pinned so the deleted trigger cannot come back by
    /// accident.
    ///
    /// The deletion is the point of the assertion. `schedule_launch_probe_if_stale`
    /// was a DEFAULT method, so every implementor — the production resolver and four
    /// render-test stubs — silently inherited a no-op trigger; a launch's
    /// re-observation therefore depended on which implementor happened to be wired.
    /// A stub that compiles here proves the trait now asks only for what render needs
    /// (plus the two optional memo hooks), so re-observation lives in exactly one
    /// place: the model-snapshot reconciler's poke.
    struct MinimalResolver;

    impl GatewayModelResolve for MinimalResolver {
        fn resolve_gateway_models(&self, _harness_kind: &str, _revision: i64) -> GatewayModelPlan {
            GatewayModelPlan {
                models: vec!["only-what-render-needs".to_string()],
                ..Default::default()
            }
        }
    }

    #[test]
    fn one_required_method_is_the_whole_seam() {
        let resolver = MinimalResolver;
        let plan = resolver.resolve_gateway_models("opencode", 7);
        assert_eq!(plan.models, vec!["only-what-render-needs"]);

        // The two optional hooks default harmlessly for a stub: nothing to invalidate,
        // and a fixed plan cannot degrade to a floor.
        resolver.invalidate_gateway_plan("opencode");
        let (blocking_plan, used_seed_floor) = resolver.resolve_gateway_models_blocking("opencode", 7);
        assert_eq!(blocking_plan, plan);
        assert!(
            !used_seed_floor,
            "a stub's fixed plan is not a degraded fallback"
        );
    }
}
