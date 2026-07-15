//! Stamps deterministic release identity into the binary at build time.
//!
//! Release builds set `PROLIFERATE_BUILD_VERSION` and `PROLIFERATE_BUILD_SHA`
//! (see the `build-binaries` job in `.github/workflows/release-runtime.yml`,
//! which derives the version from the `runtime-v<semver>` tag and the SHA from
//! the release commit). Dev and test builds leave both unset and fall back to
//! the crate's Cargo.toml version with no SHA. The resolved values are exposed
//! as the compile-time envs `PROLIFERATE_STAMPED_VERSION` and
//! `PROLIFERATE_STAMPED_GIT_SHA` (empty when unstamped), which feed `--version`
//! output, the runtime `/health` `version` field, and the Sentry release ID
//! `<component>@<version>+<12-char-sha>` (support-system "Release identity").
//!
//! Production fail-closed: when `PROLIFERATE_BUILD_VERSION` is set, a missing
//! or malformed `PROLIFERATE_BUILD_SHA` fails the build rather than shipping a
//! release ID with no deterministic SHA.
fn main() {
    println!("cargo:rerun-if-env-changed=PROLIFERATE_BUILD_VERSION");
    println!("cargo:rerun-if-env-changed=PROLIFERATE_BUILD_SHA");

    let build_version = std::env::var("PROLIFERATE_BUILD_VERSION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let version = build_version
        .clone()
        .or_else(|| std::env::var("CARGO_PKG_VERSION").ok())
        .unwrap_or_else(|| "0.0.0".to_string());

    let raw_sha = std::env::var("PROLIFERATE_BUILD_SHA")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());

    let sha = match raw_sha {
        Some(value) => {
            if value.len() < 12 || !value.chars().all(|ch| ch.is_ascii_hexdigit()) {
                panic!(
                    "PROLIFERATE_BUILD_SHA must be at least 12 lowercase hex characters, \
                     got {value:?}"
                );
            }
            value[..12].to_string()
        }
        None => {
            if build_version.is_some() {
                panic!(
                    "PROLIFERATE_BUILD_SHA is required for a production build \
                     (PROLIFERATE_BUILD_VERSION is set) so the release ID carries a \
                     deterministic git SHA"
                );
            }
            String::new()
        }
    };

    println!("cargo:rustc-env=PROLIFERATE_STAMPED_VERSION={version}");
    println!("cargo:rustc-env=PROLIFERATE_STAMPED_GIT_SHA={sha}");
}
