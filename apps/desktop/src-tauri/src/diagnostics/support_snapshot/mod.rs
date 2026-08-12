//! Consented support snapshot (PR 6). This slice owns only the exact
//! schema-3 model, validation foundation, native artifact store, and
//! purpose-specific pure support-export scrubber.

pub(crate) mod artifact_store;
pub mod schema;
pub mod scrub;
