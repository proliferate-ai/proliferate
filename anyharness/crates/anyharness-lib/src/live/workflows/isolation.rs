//! Trusted workflow process-launch boundary.
//!
//! Phase A defines a fail-closed platform port and intentionally ships no
//! production adapter. Identity/policy, broker requests, the broker port, and
//! local activation DTOs are split by ownership below.

mod activation;
mod broker;
mod identity;
mod policy;
mod process_group;
mod requests;

#[allow(unused_imports)]
pub use activation::*;
pub use broker::*;
pub use identity::*;
pub use policy::*;
pub use process_group::*;
pub use requests::*;

#[cfg(test)]
mod request_grammar_tests;
#[cfg(test)]
mod request_tests;
#[cfg(test)]
mod tests;
