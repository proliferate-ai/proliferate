//! The `workflows` product domain: durable one-prompt workflow execution in an
//! existing workspace (spec `systems/product/workflows/runs.md`). A workflow run may
//! own several sessions in later slices, so it is a top-level domain rather
//! than a sessions subdomain.

pub mod control;
mod dispatch;
mod execution;
#[cfg(test)]
pub(crate) use execution::{execute as execute_for_test, test_barriers};
pub mod model;
mod portable_service;
mod portable_validation;
pub mod resolution;
pub mod runtime;
pub mod service;
pub mod session_extension;
pub mod store;
pub mod workspace_materialization;

#[cfg(test)]
mod portable_service_tests;
#[cfg(test)]
mod service_tests;
