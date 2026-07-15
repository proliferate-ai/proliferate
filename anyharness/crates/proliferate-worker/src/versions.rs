pub fn worker_version() -> Option<String> {
    Some(env!("PROLIFERATE_STAMPED_VERSION").to_string())
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

#[cfg(test)]
mod tests {
    use super::worker_version;
    use crate::self_update::version_output_matches;

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
    fn reported_worker_version_satisfies_the_self_update_gate() {
        // The stamped `--version` output must clear the same exact-match gate
        // the worker self-update preflight and health-gate apply to a pin.
        let version = worker_version().expect("worker version");
        let clap_output = format!("proliferate-worker {version}\n");
        assert!(version_output_matches(&clap_output, &version));
    }
}
