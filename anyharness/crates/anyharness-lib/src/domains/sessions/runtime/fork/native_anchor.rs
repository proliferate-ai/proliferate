//! ACP-native targeted-fork provider anchors — the counterpart to
//! `sidedoor.rs` (which owns the OpenCode side-door DISPATCH). This module owns
//! the provider-anchor CONCERNS of a fork: deriving the ACP-native anchor
//! threaded onto the outbound `session/fork` (Claude
//! `_meta.anyharness.upToMessageId`), and formatting the child provenance tuple
//! from whichever rung-3 path resolved — side-door, native, or tip.
//!
//! A targeted native request ALWAYS carries a derived anchor or fails closed:
//! dispatch must never send an anchor-less fork for a targeted request (the
//! cardinal sin — see `fork_anchor`). Derivation runs before the live-start
//! seam so an undecodable anchor fails closed without touching the live handle.

use crate::domains::agents::model::AgentKind;
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::runtime::fork_anchor::{
    self, ProviderAnchorError, ProviderForkAnchor,
};

use super::ForkSessionError;

/// Derive the provider anchor for a NON-side-door targeted fork. Returns `None`
/// for a tip fork or an OpenCode side-door fork (that path resolves its own
/// vendor anchor downstream via `sidedoor::resolve_sidedoor_message_id`), so
/// ACP-native derivation skips it. An undecodable anchor fails closed
/// (`TARGET_NOT_FOUND`); an agent with no translator is `Unsupported`.
pub(super) fn resolve_native_provider_anchor(
    is_targeted: bool,
    agent_kind: &str,
    parent_events: &[SessionEventRecord],
    prefix_terminal_seq: i64,
) -> Result<Option<ProviderForkAnchor>, ForkSessionError> {
    if !is_targeted || agent_kind == AgentKind::OpenCode.as_str() {
        return Ok(None);
    }
    let anchor =
        fork_anchor::derive_provider_anchor(agent_kind, parent_events, prefix_terminal_seq)
            .map_err(|error| match error {
                ProviderAnchorError::NotDerivable => ForkSessionError::TargetNotFound,
                ProviderAnchorError::UnsupportedAgentKind => ForkSessionError::Unsupported(
                    "targeted fork dispatch is not implemented for this agent".to_string(),
                ),
            })?;
    Ok(Some(anchor))
}

/// Format the child's `(kind, value, inclusive, native_version)` provenance
/// from whichever rung-3 path won: the OpenCode side-door vendor message id
/// (exclusive — the fork EXCLUDES the target message) plus its resolved vendor
/// version; the ACP-native derived anchor (inclusive — the last KEPT message);
/// or the tip marker (no value). Never the parent native session id.
pub(super) fn fork_child_provenance(
    sidedoor_message_id: Option<&str>,
    sidedoor_native_version: Option<&str>,
    provider_anchor: Option<&ProviderForkAnchor>,
) -> (Option<String>, Option<String>, Option<bool>, Option<String>) {
    if let Some(message_id) = sidedoor_message_id {
        return (
            Some("opencode_message_id".to_string()),
            Some(message_id.to_string()),
            Some(false),
            sidedoor_native_version.map(str::to_string),
        );
    }
    match provider_anchor {
        Some(anchor) => (
            Some(anchor.provider_anchor_kind().to_string()),
            Some(anchor.value().to_string()),
            Some(true),
            None,
        ),
        None => (Some("tip".to_string()), None, None, None),
    }
}
