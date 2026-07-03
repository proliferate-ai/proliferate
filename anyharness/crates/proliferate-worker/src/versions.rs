pub fn worker_version() -> Option<String> {
    Some(env!("CARGO_PKG_VERSION").to_string())
}

/// The AnyHarness runtime version co-deployed with this worker, when the
/// launcher advertises it via env. The worker never introspects the runtime
/// binary itself; absence is fine — the server tolerates a missing report.
pub fn anyharness_version() -> Option<String> {
    std::env::var("PROLIFERATE_ANYHARNESS_VERSION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
