//! In-memory model of the schema-3 consented support snapshot, split by
//! ownership.
//!
//! Support-owned fields serialize camelCase; embedded accepted protocol
//! types (`proliferate_diagnostics_protocol::v1`) are reused directly and
//! retain their existing snake_case wire shape. Nullable spec fields are
//! `Option` without skip (serialize `null`); the three optional fields
//! (`exportManifest`, `exportHealth`, `sessionLedger`) skip when absent and
//! never serialize `null`. Field declaration order is the canonical
//! serialization order pinned by the golden fixture.

pub mod common;
pub mod evidence;
pub mod health;
pub mod manifest;
pub mod snapshot;
