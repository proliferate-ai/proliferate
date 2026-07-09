pub fn worker_version() -> Option<String> {
    Some(env!("CARGO_PKG_VERSION").to_string())
}

/// The AnyHarness runtime version co-deployed with this worker, as advertised
/// by the launcher via `PROLIFERATE_ANYHARNESS_VERSION` (exported into both the
/// runtime launch env and the worker sidecar env by the server bootstrap). The
/// worker never introspects the runtime binary itself; absence is fine — the
/// server tolerates a missing report, and an unstamped deployment exports
/// nothing (matching its absent pin). This is the *boot-time* version; after
/// an in-place swap the worker tracks the converged version in its store (see
/// `anyharness_update`), so heartbeats report what actually runs.
pub fn anyharness_version() -> Option<String> {
    std::env::var("PROLIFERATE_ANYHARNESS_VERSION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
