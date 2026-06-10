//! Static-truth queries over the bundled agent registry.

use super::built_in_registry;
use crate::domains::agents::model::AgentDescriptor;

/// Look up one agent's descriptor by kind — the single sanctioned way to
/// resolve a kind into a descriptor outside this domain. No inline registry
/// scans at call sites.
pub fn descriptor(kind: &str) -> Option<AgentDescriptor> {
    built_in_registry()
        .into_iter()
        .find(|descriptor| descriptor.kind.as_str() == kind)
}
