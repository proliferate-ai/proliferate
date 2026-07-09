pub fn worker_version() -> Option<String> {
    Some(env!("CARGO_PKG_VERSION").to_string())
}

/// The AnyHarness runtime version co-deployed with this worker, when the
/// launcher advertises it via env. The worker never introspects the runtime
/// binary itself; absence is fine — the server tolerates a missing report.
///
/// FOLLOW-UP: no launcher exports `PROLIFERATE_ANYHARNESS_VERSION` yet (the
/// server only knows its *pinned* runtime version, not what actually runs in
/// a sandbox, so the export has to come from whatever stages/launches the
/// runtime — the sandbox supervisor or the desktop app). Until that lands,
/// this reports `None` and `cloud_runtime_worker.anyharness_version` stays
/// NULL for real workers.
pub fn anyharness_version() -> Option<String> {
    std::env::var("PROLIFERATE_ANYHARNESS_VERSION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
