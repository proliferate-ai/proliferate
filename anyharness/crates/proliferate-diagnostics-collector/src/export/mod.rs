//! OTLP export.
//!
//! The adapter is compiled into every build, customer releases included. What
//! a build may export is decided at compile time by [`policy::EXPORT_POLICY`]:
//! a customer build carries `LifecycleOnly`, so `record_class == detailed`
//! never enters the export queue and never reaches the encoder, and the
//! free-text surface a detailed record owns therefore cannot leave the
//! machine. The `internal-dogfood-export` feature widens that to
//! `ExportPolicy::All` and adds the per-developer `dev.user` tag.
//!
//! A build exports nothing at all until a destination is configured. With no
//! endpoint the handle is `Sink::Off`, which allocates no queue, spawns no
//! task, builds no HTTP client, and loses nothing.
//!
//! Nothing here is provider-specific. The wire contract is OTLP/HTTP JSON logs
//! and the destination URL plus its request headers are configuration values,
//! so provider identity and credentials stay outside this contract exactly as
//! the observability ADR requires.

mod classification;
mod handle;
mod otlp;
pub(crate) mod policy;
mod target;
mod worker;

pub(crate) use handle::ExporterHandle;

/// The environment variable that names whose desktop produced an exported
/// record, taking priority over `$USER`.
///
/// Dogfood only, and deliberately so: this literal exists in a binary if and
/// only if `internal-dogfood-export` was enabled, which is what the desktop
/// release job greps packaged binaries for.
#[cfg(feature = "internal-dogfood-export")]
const DEV_TAG_ENV: &str = "PROLIFERATE_DIAGNOSTICS_DEV_TAG";

#[cfg(feature = "internal-dogfood-export")]
static DEV_TAG: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();

/// The configured per-developer tag, if any. `PROLIFERATE_DIAGNOSTICS_DEV_TAG`
/// takes priority over `$USER`; unset or whitespace-only values count as
/// absent. Read from the environment once and cached for the process
/// lifetime.
#[cfg(feature = "internal-dogfood-export")]
fn dev_tag() -> Option<&'static str> {
    DEV_TAG
        .get_or_init(|| {
            std::env::var(DEV_TAG_ENV)
                .ok()
                .or_else(|| std::env::var("USER").ok())
                .filter(|value| !value.trim().is_empty())
        })
        .as_deref()
}

/// A customer build has no per-developer tag at all: neither the environment
/// variable name nor `$USER` is read, so no local identity can ride out.
#[cfg(not(feature = "internal-dogfood-export"))]
fn dev_tag() -> Option<&'static str> {
    None
}
