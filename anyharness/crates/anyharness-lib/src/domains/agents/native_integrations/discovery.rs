//! Entry point for read-only discovery: given a harness kind and the home
//! directory its native config lives under, what integrations exist?
//! Spec: "Discovery". Never spawns, probes, or writes.
//!
//! Barrier stub: lane L1 implements `discover_codex`, `discover_claude` and
//! `bundles` behind this function; until then every kind discovers nothing.

use std::path::Path;

use super::model::NativeIntegration;
use crate::domains::agents::model::AgentKind;

/// Discover the native integrations of `kind` under `home` (the user's home
/// directory, where `~/.codex` and `~/.claude.json` live).
pub fn discover(kind: &AgentKind, home: &Path) -> Vec<NativeIntegration> {
    let _ = (kind, home);
    Vec::new()
}
