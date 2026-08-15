//! Internal/dogfood OTLP export.
//!
//! The whole adapter lives behind the non-default `internal-dogfood-export`
//! Cargo feature. A customer collector binary is compiled from
//! [`absent`], which owns no configuration read, queue, task, HTTP client, or
//! credential handling; the release packaging job proves the absence by
//! grepping the shipped binary for the endpoint variable name. An internal
//! binary compiles [`present`] and still exports nothing until a destination is
//! configured out of band.
//!
//! Nothing here is provider-specific. The wire contract is OTLP/HTTP JSON logs
//! and the destination URL plus its request headers are configuration values,
//! so provider identity and credentials stay outside this contract exactly as
//! the observability ADR requires.

#[cfg_attr(feature = "internal-dogfood-export", path = "present.rs")]
#[cfg_attr(not(feature = "internal-dogfood-export"), path = "absent.rs")]
mod handle;

#[cfg(feature = "internal-dogfood-export")]
mod classification;
#[cfg(feature = "internal-dogfood-export")]
mod otlp;
#[cfg(feature = "internal-dogfood-export")]
mod target;
#[cfg(feature = "internal-dogfood-export")]
mod worker;

pub(crate) use handle::ExporterHandle;

/// The environment variable that names whose desktop produced an exported
/// record, taking priority over `$USER`.
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
