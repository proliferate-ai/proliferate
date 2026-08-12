//! Consented support snapshot (PR 6). This slice owns only the exact
//! schema-3 model, validation foundation, and native artifact store.

pub mod schema;
pub(crate) mod artifact_store;
