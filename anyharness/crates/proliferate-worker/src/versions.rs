use tracing::warn;

use crate::store::WorkerStore;

pub fn worker_version() -> Option<String> {
    Some(env!("PROLIFERATE_STAMPED_VERSION").to_string())
}

/// The AnyHarness runtime version co-deployed with this worker, as advertised
/// by the launcher via `PROLIFERATE_ANYHARNESS_VERSION` (exported into both the
/// runtime launch env and the worker sidecar env by the server bootstrap). The
/// worker never introspects the runtime binary itself; absence is fine — the
/// server tolerates a missing report, and an unstamped deployment exports
/// nothing (matching its absent pin). This is the *boot-time* version; after a
/// Supervisor activation the worker tracks the converged version in its store,
/// so heartbeats report what actually runs (see `running_anyharness_version`).
pub fn anyharness_version() -> Option<String> {
    std::env::var("PROLIFERATE_ANYHARNESS_VERSION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// The runtime version the worker believes is running: the last
/// Supervisor-activated convergence it recorded (store) if any, else the
/// boot-time launcher export (env). The heartbeat reports this so
/// `cloud_runtime_worker.anyharness_version` reflects what actually runs
/// within one interval of an activation (R9-006).
pub fn running_anyharness_version(store: &WorkerStore) -> Option<String> {
    match store.anyharness_converged_version() {
        Ok(Some(version)) => Some(version),
        Ok(None) => anyharness_version(),
        Err(error) => {
            warn!(
                ?error,
                "failed to read converged anyharness version; falling back to env"
            );
            anyharness_version()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::worker_version;

    #[test]
    fn worker_version_is_stamped_and_non_empty() {
        let version = worker_version().expect("worker version is always reported");
        assert!(!version.is_empty());
    }

    #[test]
    fn worker_version_falls_back_to_crate_version_without_a_release_stamp() {
        // Dev and test builds leave PROLIFERATE_BUILD_VERSION unset, so the
        // build script stamps the crate's Cargo.toml version.
        assert_eq!(
            env!("PROLIFERATE_STAMPED_VERSION"),
            env!("CARGO_PKG_VERSION")
        );
    }

    #[test]
    fn reported_worker_version_satisfies_the_supervisor_activation_gate() {
        // The stamped `--version` output must clear the exact-match gate the
        // SUPERVISOR applies when it health-gates an activated Worker binary
        // (`proliferate-supervisor` `process::version_output_matches`):
        // whitespace tokens, tolerating a leading `v`, never substrings. The
        // matcher is inlined here because the worker no longer carries one of
        // its own.
        fn version_output_matches(output: &str, desired: &str) -> bool {
            output
                .split_whitespace()
                .any(|token| token == desired || token.strip_prefix('v') == Some(desired))
        }
        let version = worker_version().expect("worker version");
        let clap_output = format!("proliferate-worker {version}\n");
        assert!(version_output_matches(&clap_output, &version));
    }
}
