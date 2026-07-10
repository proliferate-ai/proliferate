//! Stamps the release version into the binary at build time.
//!
//! Release builds set `PROLIFERATE_BUILD_VERSION` (see the `build-binaries`
//! job in `.github/workflows/release-runtime.yml`, which derives it from the
//! `runtime-v<semver>` tag). Dev and test builds leave it unset and fall back
//! to the crate's Cargo.toml version. The resolved value is exposed to the
//! crate as the compile-time env `PROLIFERATE_STAMPED_VERSION`, which feeds
//! `--version` output and the runtime `/health` `version` field so the worker
//! self-update gates can converge on the pinned semver.
fn main() {
    println!("cargo:rerun-if-env-changed=PROLIFERATE_BUILD_VERSION");
    let version = std::env::var("PROLIFERATE_BUILD_VERSION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var("CARGO_PKG_VERSION").ok())
        .unwrap_or_else(|| "0.0.0".to_string());
    println!("cargo:rustc-env=PROLIFERATE_STAMPED_VERSION={version}");
}
