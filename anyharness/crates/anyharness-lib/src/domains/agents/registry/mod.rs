pub mod bundled;
pub mod service;
pub mod projection;
pub mod schema;
pub mod validation;

use super::model::AgentDescriptor;
use projection::bundled_agent_descriptors;
pub use service::descriptor;

/// Returns the built-in registry of supported agent descriptors for v1.
///
/// Process/auth/install metadata is runtime-trusted only from the bundled
/// agent registry.
pub fn built_in_registry() -> Vec<AgentDescriptor> {
    bundled_agent_descriptors()
}
