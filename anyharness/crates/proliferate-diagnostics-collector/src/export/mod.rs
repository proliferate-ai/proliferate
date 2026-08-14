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
