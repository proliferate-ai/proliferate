//! Consented support snapshot (PR 6): exact schema, pure scrub/assembly,
//! durable artifact storage, and the main-window native coordinator.

pub(crate) mod artifact_store;
pub mod assembly;
pub(crate) mod coordinator;
pub mod schema;
pub mod scrub;
