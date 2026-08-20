use crate::domains::workspaces::checkpoints::WorkspaceCheckpointService;

/// Resolve the checkpoint already captured at this exact targeted-fork
/// boundary. Fork dispatch only links existing checkpoint provenance: it never
/// captures, chooses a nearby boundary, or falls back through `prompt_id`.
/// Capture-off and rowless boundaries deliberately remain `None`.
pub(super) fn find_exact(
    checkpoints: &WorkspaceCheckpointService,
    parent_session_id: &str,
    anchor_turn_id: Option<&str>,
) -> Option<String> {
    anchor_turn_id
        .and_then(|turn_id| checkpoints.find_checkpoint_id_for_boundary(parent_session_id, turn_id))
}
