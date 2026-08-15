//! Boot-time assert that the AnyHarness sidecar actually running is the one
//! this desktop build shipped.
//!
//! Release CI (`.github/workflows/release-desktop.yml`) writes
//! `apps/desktop/runtime-version.json` from the `anyharness` crate's
//! `Cargo.toml` version right before `pnpm tauri build` compiles this crate,
//! so `include_str!` bakes in the version the shipped sidecar binary was
//! actually built from. Caveat: the `anyharness` crate version is a
//! never-bumped `0.1.0` today, so `expected == actual` trivially passes on
//! every current build; the assert's value is catching a corrupted or
//! mismatched bundle (the wrong sidecar binary shipped alongside this shell)
//! and future decoupling, not today's version drift. A version-bump scheme is
//! a release-pipeline decision left as a follow-up, not invented here.
//!
//! Every read on this boundary is tolerant: a missing/garbage bundled file, or
//! a health response missing the version field, only ever warns — it must
//! never brick boot.

use std::sync::OnceLock;

/// Written by release CI before `pnpm tauri build`; falls back to whatever is
/// checked into the repo (a real, if unbumped, version) for local/dev builds.
const BUNDLED_RUNTIME_VERSION_JSON: &str = include_str!("../../runtime-version.json");

const ASSERT_MODE_ENV: &str = "PROLIFERATE_RUNTIME_VERSION_ASSERT";
/// The `ANYHARNESS_DEV_URL` external-runtime path talks to a developer's own
/// build, which routinely diverges from the bundled version pin. That path
/// always stays warn-only regardless of the configured mode.
const DEV_URL_ENV: &str = "ANYHARNESS_DEV_URL";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssertMode {
    Off,
    Warn,
    Block,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledRuntimeVersion {
    anyharness_version: String,
}

fn expected_version() -> Option<&'static str> {
    static PARSED: OnceLock<Option<BundledRuntimeVersion>> = OnceLock::new();
    PARSED
        .get_or_init(|| {
            match serde_json::from_str::<BundledRuntimeVersion>(BUNDLED_RUNTIME_VERSION_JSON) {
                Ok(parsed) => Some(parsed),
                Err(error) => {
                    tracing::warn!(
                        error = %error,
                        "runtime-version.json failed to parse; skipping runtime version assert"
                    );
                    None
                }
            }
        })
        .as_ref()
        .map(|v| v.anyharness_version.as_str())
}

/// Pure derivation of the assert mode, kept separate from the env reads in
/// `assert_mode()` so it is unit-testable without touching process-global env
/// (which would otherwise make parallel tests race).
fn assert_mode_from(raw_mode: Option<&str>, dev_url_set: bool) -> AssertMode {
    if dev_url_set {
        return AssertMode::Warn;
    }
    match raw_mode {
        Some("off") => AssertMode::Off,
        Some("block") => AssertMode::Block,
        // Any unrecognized value (including a typo) falls back to `warn`
        // rather than failing closed.
        _ => AssertMode::Warn,
    }
}

/// Reads `PROLIFERATE_RUNTIME_VERSION_ASSERT` (`off`/`warn`/`block`, default
/// `warn`). Forces `Warn` when the dev-URL bypass is active.
pub fn assert_mode() -> AssertMode {
    assert_mode_from(
        std::env::var(ASSERT_MODE_ENV).ok().as_deref(),
        std::env::var(DEV_URL_ENV).is_ok(),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VersionCheckOutcome {
    /// Match, unknown expected/actual (fail-open), or a mismatch under `warn`/`off`.
    Pass,
    /// A confirmed mismatch under `block` mode.
    Blocked,
}

/// Pure comparison against a supplied mode; the fail-open branches (no
/// expected version, no actual version) short-circuit before ever looking at
/// `mode` besides the `Off` fast path.
fn check_with_mode(
    actual_version: Option<&str>,
    expected_version: Option<&str>,
    mode: AssertMode,
) -> VersionCheckOutcome {
    if mode == AssertMode::Off {
        return VersionCheckOutcome::Pass;
    }
    let Some(expected) = expected_version else {
        return VersionCheckOutcome::Pass;
    };
    let Some(actual) = actual_version else {
        tracing::warn!(
            expected_anyharness_version = expected,
            "AnyHarness health record carried no version; skipping runtime version assert"
        );
        return VersionCheckOutcome::Pass;
    };
    if expected == actual {
        return VersionCheckOutcome::Pass;
    }

    match mode {
        AssertMode::Block => {
            tracing::error!(
                expected_anyharness_version = expected,
                actual_anyharness_version = actual,
                "AnyHarness runtime version mismatch; blocking boot"
            );
            VersionCheckOutcome::Blocked
        }
        AssertMode::Warn => {
            tracing::warn!(
                expected_anyharness_version = expected,
                actual_anyharness_version = actual,
                "AnyHarness runtime version mismatch"
            );
            VersionCheckOutcome::Pass
        }
        AssertMode::Off => unreachable!("handled above"),
    }
}

/// Compare the bundled expected AnyHarness version against the version the
/// booted sidecar actually reported in its health record. `expected_version`
/// itself already warns once (via `OnceLock`) if the bundled file fails to
/// parse.
pub fn check(actual_version: Option<&str>) -> VersionCheckOutcome {
    check_with_mode(actual_version, expected_version(), assert_mode())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_warn() {
        assert_eq!(assert_mode_from(None, false), AssertMode::Warn);
    }

    #[test]
    fn reads_off_and_block() {
        assert_eq!(assert_mode_from(Some("off"), false), AssertMode::Off);
        assert_eq!(assert_mode_from(Some("block"), false), AssertMode::Block);
    }

    #[test]
    fn unrecognized_value_falls_back_to_warn() {
        assert_eq!(assert_mode_from(Some("garbage"), false), AssertMode::Warn);
    }

    #[test]
    fn dev_url_forces_warn_even_under_block() {
        assert_eq!(assert_mode_from(Some("block"), true), AssertMode::Warn);
    }

    #[test]
    fn off_mode_never_blocks_even_on_mismatch() {
        assert_eq!(
            check_with_mode(Some("9.9.9"), Some("0.1.0"), AssertMode::Off),
            VersionCheckOutcome::Pass
        );
    }

    #[test]
    fn warn_mode_never_blocks_on_mismatch() {
        assert_eq!(
            check_with_mode(Some("9.9.9"), Some("0.1.0"), AssertMode::Warn),
            VersionCheckOutcome::Pass
        );
    }

    #[test]
    fn block_mode_blocks_on_confirmed_mismatch() {
        assert_eq!(
            check_with_mode(Some("9.9.9"), Some("0.1.0"), AssertMode::Block),
            VersionCheckOutcome::Blocked
        );
    }

    #[test]
    fn block_mode_passes_on_missing_actual_version() {
        assert_eq!(
            check_with_mode(None, Some("0.1.0"), AssertMode::Block),
            VersionCheckOutcome::Pass
        );
    }

    #[test]
    fn block_mode_passes_on_missing_expected_version() {
        // Simulates a bundled runtime-version.json that failed to parse.
        assert_eq!(
            check_with_mode(Some("0.1.0"), None, AssertMode::Block),
            VersionCheckOutcome::Pass
        );
    }

    #[test]
    fn block_mode_passes_on_exact_match() {
        assert_eq!(
            check_with_mode(Some("0.1.0"), Some("0.1.0"), AssertMode::Block),
            VersionCheckOutcome::Pass
        );
    }

    #[test]
    fn public_check_matches_the_bundled_file_today() {
        // The repo's checked-in runtime-version.json parses and matches
        // itself; this exercises the real include_str! + OnceLock path (not
        // just the pure `check_with_mode` matrix above) without depending on
        // env state.
        let expected = expected_version().expect("bundled runtime-version.json must parse");
        assert_eq!(
            check_with_mode(Some(expected), expected_version(), assert_mode()),
            VersionCheckOutcome::Pass
        );
        // `check` itself, exercised end to end.
        let _ = check(Some(expected));
    }
}
