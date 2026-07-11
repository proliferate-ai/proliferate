pub mod action;
pub mod delivery;
// WF-ID has no production persistence/activation edge. This compatibility
// seam exists only for legacy unit fixtures until PLAN-V2 + final credentials
// add an atomic, authenticated activation path.
#[cfg(test)]
mod delivery_acceptance;
#[cfg(test)]
mod delivery_tests;
pub mod effects;
pub mod engine;
pub mod model;
mod observations;
pub mod plan;
pub mod service;
pub mod store;
mod support;
pub mod templates;

#[cfg(test)]
mod fault_tests;
#[cfg(test)]
mod observation_tests;
#[cfg(test)]
mod service_tests;
