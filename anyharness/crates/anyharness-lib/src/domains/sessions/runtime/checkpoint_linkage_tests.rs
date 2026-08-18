//! Lane H fork/checkpoint linkage suite, split out of `tests.rs` to stay
//! under the repo line cap; the shared fork-state harness
//! (`build_forkable_fork_state`) lives in `tests.rs`.

use super::tests::build_forkable_fork_state;

/// Positive Q-H4 linkage seam. The full targeted-fork path that stamps
/// `checkpoint_id` from a resolved anchor boundary is undrivable in Tier 1 here
/// (targeted native dispatch fails closed until rung 3), so this pins the two
/// seams `fork_session` composes: (1) the boundary lookup
/// `find_checkpoint_id_for_boundary`, seeded with a checkpoint whose
/// `(session_id, turn_id)` matches, resolves to the checkpoint id; and (2) a
/// `fork_operations` row carrying that id round-trips through the store.
#[tokio::test(flavor = "current_thread")]
async fn checkpoint_linkage_stamps_the_boundary_checkpoint_id_onto_the_fork_operation() {
    use crate::domains::sessions::model::{ForkOperationPhase, ForkOperationRecord};
    use crate::domains::workspaces::checkpoints::{CheckpointOrigin, CheckpointRecord};
    let (state, parent_id, runtime_home) = build_forkable_fork_state(r#"{"fork":true}"#);

    // Seed a turn-start checkpoint at the (parent_session_id, turn_id) boundary.
    let checkpoint = CheckpointRecord {
        id: "chk-boundary-1".to_string(),
        workspace_id: "workspace-fork-rung2".to_string(),
        origin: CheckpointOrigin::TurnStart,
        session_id: Some(parent_id.clone()),
        turn_id: Some("turn-7".to_string()),
        prompt_id: None,
        fork_operation_id: None,
        revert_operation_id: None,
        head_sha: "0".repeat(40),
        work_tree_oid: "1".repeat(40),
        index_tree_oid: "2".repeat(40),
        work_tree_anchored: false,
        index_tree_anchored: false,
        notices_json: None,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
        expired_at: None,
    };
    state
        .workspace_checkpoint_service
        .store_for_tests()
        .insert_checkpoint(&checkpoint)
        .expect("seed checkpoint");

    // Seam 1: the exact lookup fork.rs performs for a resolved anchor boundary.
    let resolved = state
        .workspace_checkpoint_service
        .find_checkpoint_id_for_boundary(&parent_id, "turn-7");
    assert_eq!(
        resolved.as_deref(),
        Some("chk-boundary-1"),
        "the boundary lookup resolves the seeded checkpoint id"
    );
    // A non-matching turn resolves to nothing (best-effort NULL).
    assert_eq!(
        state
            .workspace_checkpoint_service
            .find_checkpoint_id_for_boundary(&parent_id, "turn-other"),
        None
    );

    // Seam 2: a fork operation carrying that id round-trips through the store.
    let operation = ForkOperationRecord {
        id: uuid::Uuid::new_v4().to_string(),
        idempotency_key: "linked-child".to_string(),
        request_digest: "digest".to_string(),
        parent_session_id: parent_id.clone(),
        child_session_id: "linked-child".to_string(),
        phase: ForkOperationPhase::Completed,
        anchor_turn_id: Some("turn-7".to_string()),
        anchor_item_id: Some("item-7".to_string()),
        provider_anchor_kind: Some("targeted".to_string()),
        provider_anchor_value: None,
        provider_anchor_inclusive: None,
        prefix_terminal_seq: Some(0),
        prefix_digest: Some("digest".to_string()),
        adapter_version: None,
        native_version: None,
        native_child_session_id: None,
        checkpoint_id: resolved,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
    };
    state
        .session_service
        .store()
        .insert_fork_operation(&operation)
        .expect("insert operation");

    let stored = state
        .session_service
        .store()
        .find_fork_operation_by_key("linked-child")
        .expect("read fork operation")
        .expect("operation row present");
    assert_eq!(
        stored.checkpoint_id.as_deref(),
        Some("chk-boundary-1"),
        "the fork operation row carries the boundary checkpoint id"
    );
    let _ = std::fs::remove_dir_all(&runtime_home);
}
