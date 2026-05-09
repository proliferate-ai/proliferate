use super::catalog::bundled_agent_descriptors;
use super::model::AgentDescriptor;

/// Returns the built-in registry of supported agent descriptors for v1.
///
/// Process/auth/install metadata is runtime-trusted only from the bundled
/// agent catalog. Remote catalogs may update session/model/control metadata
/// through catalog services, but they must not change executable descriptors.
pub fn built_in_registry() -> Vec<AgentDescriptor> {
    bundled_agent_descriptors()
}
