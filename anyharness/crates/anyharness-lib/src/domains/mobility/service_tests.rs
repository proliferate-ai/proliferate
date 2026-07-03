//! `MobilityService` export/preflight validation tests — the pure-function
//! relocation-classification and handoff-runtime-state checks. Split out of
//! `service.rs` (with the install/round-trip tests in `service_install_tests.rs`)
//! to keep each file under the repo max-lines cap; compiled as a child of
//! `service` via `#[path]` so `use super::*` still reaches its private items.

use super::*;

#[test]
fn relocation_ignores_unrelated_remote_owned_duplicate() {
    let should_relocate = classify_existing_archive_session_for_relocation(
        "new-cloud-workspace",
        Some("local-source-workspace"),
        "/local/source",
        "old-cloud-workspace",
        "/cloud/old-source",
        WorkspaceAccessMode::RemoteOwned,
    )
    .expect("unrelated remote-owned leftovers should not error");

    assert!(!should_relocate);
}

#[test]
fn relocation_rejects_unrelated_normal_workspace_duplicate() {
    let should_relocate = classify_existing_archive_session_for_relocation(
        "new-cloud-workspace",
        Some("local-source-workspace"),
        "/local/source",
        "other-workspace",
        "/other/source",
        WorkspaceAccessMode::Normal,
    )
    .expect("unrelated normal workspace should not error");

    assert!(!should_relocate);
}

#[test]
fn relocation_requires_matching_source_to_be_frozen() {
    let error = classify_existing_archive_session_for_relocation(
        "destination-workspace",
        Some("source-workspace"),
        "/source",
        "source-workspace",
        "/source",
        WorkspaceAccessMode::Normal,
    )
    .expect_err("matching source must be frozen");

    assert!(matches!(error, MobilityError::Invalid(_)));
}

#[test]
fn export_runtime_state_requires_matching_frozen_handoff() {
    let options = WorkspaceMobilityExportOptions {
        require_clean_git_state: true,
        expected_handoff_op_id: Some("handoff-1".to_string()),
        ..Default::default()
    };
    let runtime_state = WorkspaceAccessRecord {
        workspace_id: "workspace-1".to_string(),
        mode: WorkspaceAccessMode::FrozenForHandoff,
        handoff_op_id: Some("handoff-1".to_string()),
        updated_at: "2026-03-25T00:00:01Z".to_string(),
    };

    validate_expected_handoff_runtime_state("workspace-1", &runtime_state, &options)
        .expect("matching handoff should be exportable");
}

#[test]
fn export_runtime_state_rejects_stale_handoff() {
    let options = WorkspaceMobilityExportOptions {
        require_clean_git_state: true,
        expected_handoff_op_id: Some("handoff-1".to_string()),
        ..Default::default()
    };
    let runtime_state = WorkspaceAccessRecord {
        workspace_id: "workspace-1".to_string(),
        mode: WorkspaceAccessMode::FrozenForHandoff,
        handoff_op_id: Some("other-handoff".to_string()),
        updated_at: "2026-03-25T00:00:01Z".to_string(),
    };

    let error = validate_expected_handoff_runtime_state("workspace-1", &runtime_state, &options)
        .expect_err("stale handoff should be rejected");

    assert!(matches!(error, MobilityError::Invalid(_)));
}

#[test]
fn export_runtime_state_rejects_normal_workspace() {
    let options = WorkspaceMobilityExportOptions {
        require_clean_git_state: true,
        expected_handoff_op_id: Some("handoff-1".to_string()),
        ..Default::default()
    };
    let runtime_state = WorkspaceAccessRecord {
        workspace_id: "workspace-1".to_string(),
        mode: WorkspaceAccessMode::Normal,
        handoff_op_id: None,
        updated_at: "2026-03-25T00:00:01Z".to_string(),
    };

    let error = validate_expected_handoff_runtime_state("workspace-1", &runtime_state, &options)
        .expect_err("normal runtime state should be rejected");

    assert!(matches!(error, MobilityError::Invalid(_)));
}
