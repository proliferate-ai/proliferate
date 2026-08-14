//! Exact in-memory schema of the schema-3 consented support snapshot.
//!
//! Owns the support artifact model (`model/`), its closed enums (`enums`),
//! the fixed spec bounds (`limits`), and validation over both (`validate`).
//! Accepted diagnostics protocol types are embedded from
//! `proliferate_diagnostics_protocol::v1` and never forked here.

pub mod enums;
pub mod limits;
pub mod model;
pub mod validate;

#[cfg(test)]
mod tests;
