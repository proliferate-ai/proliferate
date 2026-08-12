use std::sync::Arc;

use tauri::State;

use crate::diagnostics::support_snapshot::coordinator::model::{
    BeginSupportSnapshotInput, BeginSupportSnapshotSubmissionInput,
    BeginSupportSnapshotSubmissionOutput, CancelSupportSnapshotInput,
    DeleteStagedSupportSnapshotInput, FinishSupportSnapshotInput,
    FinishSupportSnapshotSubmissionInput, PreparedSupportSnapshotOutput,
    ReadStagedSupportSnapshotInput, ReadStagedSupportSnapshotOutput,
    ReconcileStagedSupportSnapshotsInput, ReconciledSupportArtifactOutput,
    SaveSupportSnapshotArchiveInput, SaveSupportSnapshotArchiveOutput,
    SupportSnapshotPreparationOutput,
};
use crate::diagnostics::support_snapshot::coordinator::SupportSnapshotCoordinator;

mod dialog;

#[tauri::command]
pub async fn begin_support_snapshot_preparation(
    window: tauri::WebviewWindow,
    coordinator: State<'_, Arc<SupportSnapshotCoordinator>>,
    input: BeginSupportSnapshotInput,
) -> Result<SupportSnapshotPreparationOutput, String> {
    require_main_window(window.label())?;
    coordinator.begin_preparation(input).await
}

#[tauri::command]
pub async fn finish_support_snapshot_preparation(
    window: tauri::WebviewWindow,
    coordinator: State<'_, Arc<SupportSnapshotCoordinator>>,
    input: FinishSupportSnapshotInput,
) -> Result<PreparedSupportSnapshotOutput, String> {
    require_main_window(window.label())?;
    coordinator.finish_preparation(input).await
}

#[tauri::command]
pub async fn cancel_support_snapshot_preparation(
    window: tauri::WebviewWindow,
    coordinator: State<'_, Arc<SupportSnapshotCoordinator>>,
    input: CancelSupportSnapshotInput,
) -> Result<(), String> {
    require_main_window(window.label())?;
    coordinator.cancel_preparation(input).await
}

#[tauri::command]
pub async fn save_support_snapshot_archive(
    window: tauri::WebviewWindow,
    coordinator: State<'_, Arc<SupportSnapshotCoordinator>>,
    input: SaveSupportSnapshotArchiveInput,
) -> Result<Option<SaveSupportSnapshotArchiveOutput>, String> {
    require_main_window(window.label())?;
    let reference = coordinator.archive_reference(&input).await?;
    let Some((output_path, archive_name)) = dialog::choose_archive_path()? else {
        return Ok(None);
    };
    coordinator.save_archive_to(reference, output_path).await?;
    Ok(Some(SaveSupportSnapshotArchiveOutput { archive_name }))
}

#[tauri::command]
pub async fn read_staged_support_snapshot(
    window: tauri::WebviewWindow,
    coordinator: State<'_, Arc<SupportSnapshotCoordinator>>,
    input: ReadStagedSupportSnapshotInput,
) -> Result<ReadStagedSupportSnapshotOutput, String> {
    require_main_window(window.label())?;
    coordinator
        .read_artifact(input)
        .await
        .map(|data_base64| ReadStagedSupportSnapshotOutput { data_base64 })
}

#[tauri::command]
pub async fn delete_staged_support_snapshot(
    window: tauri::WebviewWindow,
    coordinator: State<'_, Arc<SupportSnapshotCoordinator>>,
    input: DeleteStagedSupportSnapshotInput,
) -> Result<(), String> {
    require_main_window(window.label())?;
    coordinator.delete_artifact(input).await
}

#[tauri::command]
pub async fn reconcile_staged_support_snapshots(
    window: tauri::WebviewWindow,
    coordinator: State<'_, Arc<SupportSnapshotCoordinator>>,
    input: ReconcileStagedSupportSnapshotsInput,
) -> Result<Vec<ReconciledSupportArtifactOutput>, String> {
    require_main_window(window.label())?;
    coordinator.reconcile_artifacts(input).await
}

#[tauri::command]
pub async fn begin_support_snapshot_submission(
    window: tauri::WebviewWindow,
    coordinator: State<'_, Arc<SupportSnapshotCoordinator>>,
    input: BeginSupportSnapshotSubmissionInput,
) -> Result<BeginSupportSnapshotSubmissionOutput, String> {
    require_main_window(window.label())?;
    coordinator.begin_submission(input).await
}

#[tauri::command]
pub async fn finish_support_snapshot_submission(
    window: tauri::WebviewWindow,
    coordinator: State<'_, Arc<SupportSnapshotCoordinator>>,
    input: FinishSupportSnapshotSubmissionInput,
) -> Result<(), String> {
    require_main_window(window.label())?;
    coordinator.finish_submission(input).await
}

fn require_main_window(label: &str) -> Result<(), String> {
    (label == "main")
        .then_some(())
        .ok_or_else(|| "support_snapshot_wrong_window".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_nine_commands_share_the_main_window_gate() {
        let commands = [
            "begin_support_snapshot_preparation",
            "finish_support_snapshot_preparation",
            "cancel_support_snapshot_preparation",
            "save_support_snapshot_archive",
            "read_staged_support_snapshot",
            "delete_staged_support_snapshot",
            "reconcile_staged_support_snapshots",
            "begin_support_snapshot_submission",
            "finish_support_snapshot_submission",
        ];
        for command in commands {
            assert_eq!(
                require_main_window(command),
                Err("support_snapshot_wrong_window".to_string())
            );
        }
        assert_eq!(require_main_window("main"), Ok(()));
    }
}
