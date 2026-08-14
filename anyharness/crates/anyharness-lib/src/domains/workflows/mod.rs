//! The gen-2 `workflows` product domain (the Workflows ADR): durable truth for
//! client-orchestrated workflow runs. A run is a verbatim definition snapshot
//! plus a chain of node rows; every node that executes is an ordinary session
//! in the run workspace. This domain owns the three SQLite tables and every
//! transaction that touches them, DSL validation, and the pure transition
//! function the live engine (PR4) drives. SQLite is the sole execution truth:
//! every transition persists in one transaction before any side effect, reads
//! come from rows, and actors are reconstructible from rows.

pub mod definition;
pub mod invariants;
pub mod model;
pub mod projection;
pub mod store;
pub mod transition;

#[cfg(test)]
#[path = "definition_tests.rs"]
mod definition_tests;
#[cfg(test)]
#[path = "store_tests.rs"]
mod store_tests;
#[cfg(test)]
#[path = "transition_tests.rs"]
mod transition_tests;
