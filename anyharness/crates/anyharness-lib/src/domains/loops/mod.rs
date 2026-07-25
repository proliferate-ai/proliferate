//! Loops domain: recurring in-session prompts (spec
//! `specs/tbd/goals-and-workflows-v1.md` §2.7). Two substrates behind one
//! mirror table:
//!
//! - **native** (claude session crons): rows mirror sidecar LoopPort state;
//!   writes round-trip through `_anyharness/loop/set|clear|list` and the
//!   mirror transitions when tagged notifications are ingested
//!   (`session_observer`).
//! - **emulated** (codex — no native substrate): rows are runtime-owned;
//!   [`scheduler::LoopSchedulerExtension`] fires the prompt on schedule,
//!   only at idle, coalescing missed fires.
//!
//! Unlike goals, multiple loops per session are allowed — the native Claude
//! shape (`CronList` returns a list).

pub mod model;
pub(crate) mod ops;
pub mod runtime;
pub mod scheduler;
pub mod service;
pub mod session_observer;
pub mod store;
pub mod wire;

#[cfg(test)]
mod service_tests;
