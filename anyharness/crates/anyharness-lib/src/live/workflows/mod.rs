//! The deterministic workflow run engine's live layer: one actor per run
//! driving the domain step engine against real sessions, goals, shells, and PRs.
//! The durable truth (records, plan, cursor, transitions) lives in
//! `domains/workflows`; this layer owns only the live actor state.

mod actor;
mod commands;
mod executor;
mod manager;

pub use executor::WorkflowExecDeps;
pub use manager::WorkflowRunManager;
