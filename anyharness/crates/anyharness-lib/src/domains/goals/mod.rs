//! Goals domain: the normalized mirror of native harness goals (spec
//! `specs/tbd/goals-and-workflows-v1.md` §2). Mirrors `domains/plans/` — the
//! proven "native harness concept → first-class Proliferate object" pattern.
//!
//! The mirror is never a source of truth: writes go down through the sidecar
//! GoalPort ext methods (`_anyharness/goal/set|get|clear`) and the mirror
//! transitions only when the tagged native notification round-trips
//! (`session_observer`). The runtime records a write *intent* (caps +
//! provenance) that the observer folds into the mirror row on ingest.

pub mod guard;
pub mod model;
pub mod runtime;
pub mod service;
pub mod session_observer;
pub mod store;
pub mod wire;

#[cfg(test)]
mod service_tests;
