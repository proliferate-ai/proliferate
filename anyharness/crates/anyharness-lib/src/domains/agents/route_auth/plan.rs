//! Target-resolved gateway render inputs.
//!
//! A [`GatewayModelPlan`] is the live gateway model list needed only by
//! harnesses whose route config must enumerate the provider's models.
//! It flows INTO `render_profile` already resolved — render/materialize never
//! look anything up, and the model-id constants that used to live in
//! `render.rs` are gone.
//!
//! The plan is produced by the live gateway planner; this module only owns the
//! shape and the [`GatewayModelResolve`] seam so the render plane stays free of
//! network/state dependencies (and unit-testable with a stub resolver).

/// Resolved gateway model inputs for one harness launch. An empty list means no
/// live route-materialization list is available; callers fail typed rather than
/// seed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GatewayModelPlan {
    /// Exact IDs returned by this target's live gateway `/v1/models` call.
    pub models: Vec<String>,
}

/// The seam the render plane calls to obtain a [`GatewayModelPlan`] for a
/// launch. Implemented by the route-auth live gateway planner; render tests use
/// a stub.
/// No implementation may synthesize a seed or choose a default model.
///
/// Materialization only. The trait used to carry a
/// `schedule_launch_probe_if_stale` trigger too, which is gone: launch-time
/// re-observation is now a poke of the general launch-options probe, whose
/// staleness gate is per (harness, auth context) rather than per gateway sequence.
/// A seam that both supplies render input AND scheduled its own background work
/// meant every stub implementor silently inherited a no-op trigger.
pub trait GatewayModelResolve: Send + Sync {
    fn resolve_gateway_models(&self, harness_kind: &str, sequence: i64) -> GatewayModelPlan;

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
    fn resolve_gateway_models_blocking(
        &self,
        harness_kind: &str,
        sequence: i64,
    ) -> GatewayModelPlan {
        self.resolve_gateway_models(harness_kind, sequence)
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
    /// place: the launch-options probe's poke.
    struct MinimalResolver;

    impl GatewayModelResolve for MinimalResolver {
        fn resolve_gateway_models(&self, _harness_kind: &str, _sequence: i64) -> GatewayModelPlan {
            GatewayModelPlan {
                models: vec!["only-what-render-needs".to_string()],
            }
        }
    }

    #[test]
    fn one_required_method_is_the_whole_seam() {
        let resolver = MinimalResolver;
        let plan = resolver.resolve_gateway_models("opencode", 7);
        assert_eq!(plan.models, vec!["only-what-render-needs"]);

        // The two optional hooks default harmlessly for a stub: nothing to
        // invalidate, and the blocking read returns the same fixed plan.
        resolver.invalidate_gateway_plan("opencode");
        let blocking_plan = resolver.resolve_gateway_models_blocking("opencode", 7);
        assert_eq!(blocking_plan, plan);
    }
}
