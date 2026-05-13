use super::catalog::projection::descriptors::bundled_agent_descriptors;
use super::model::AgentDescriptor;

/// Returns the built-in registry of supported agent descriptors for v1.
///
/// Process/auth/install metadata is runtime-trusted only from the bundled
/// agent catalog.
pub fn built_in_registry() -> Vec<AgentDescriptor> {
    bundled_agent_descriptors()
}
