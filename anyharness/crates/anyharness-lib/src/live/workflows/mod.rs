//! The deterministic workflow run engine's live layer: one actor per run
//! driving the domain step engine against real sessions, goals, shells, and PRs.
//! The durable truth (records, plan, cursor, transitions) lives in
//! `domains/workflows`; this layer owns only the live actor state.

pub(crate) mod actor;
mod agent_turn;
#[cfg(test)]
mod agent_turn_tests;
mod commands;
mod effect_ledger;
mod effects;
mod emit;
mod exec_policy;
mod executor;
mod gateway;
mod goal;
mod manager;
mod merge;
mod observation;
mod parallel;
#[cfg(test)]
mod parallel_tests;
mod receipts;
mod turn;

pub use exec_policy::{WorkflowAutoApproveAdvisor, WorkflowOwnedSessions};
pub use executor::WorkflowExecDeps;
pub use gateway::{
    HttpRunPingSink, RunPingSink, WorkflowGatewaySessions,
    WorkflowRunGatewaySessionLaunchExtension,
};
pub use manager::WorkflowRunManager;
