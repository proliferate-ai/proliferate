//! Session-scoped wakes.
//!
//! A wake is armed on a session pair — watcher and target — and fires exactly
//! once, when the target next finishes a turn. There is no relationship
//! requirement between the two: reach is runtime-wide, and the pointer that
//! fires is an inbox item the watcher can ignore.
//!
//! Two halves live here. `service` arms and consumes; `hooks` is the turn-finish
//! extension that runs the consumption for whichever session just finished.

pub mod hooks;
pub mod service;

// Facade name for the wake vocabulary. The reason enum is defined next to
// the rows it is persisted in, but callers outside the domain — the HTTP
// handler, the agent-ops tools — name it here: handlers call domain
// facades, never stores.
pub use crate::domains::sessions::store::agent_wakes::AgentWakeReason;
