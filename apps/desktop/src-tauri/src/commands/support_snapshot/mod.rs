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

    /// The gate itself: labels, not command names.
    ///
    /// Every window an attacker could open carries some label other than
    /// `main`, so the rule is an exact match on that one label and nothing
    /// else -- not a prefix, not a case-insensitive compare, not a substring.
    #[test]
    fn the_window_gate_admits_the_main_label_and_no_other() {
        assert_eq!(require_main_window("main"), Ok(()));
        for label in ["", "Main", "MAIN", "main2", "mainx", "notmain", "secondary"] {
            assert_eq!(
                require_main_window(label),
                Err("support_snapshot_wrong_window".to_string()),
                "label {label:?} must not pass the gate",
            );
        }
    }

    /// Every command applies the gate.
    ///
    /// A renderer reaches the coordinator only through this module, so a
    /// command that forgets the gate is exposed to every window in the app.
    /// No unit call can observe that -- building a `WebviewWindow` needs a
    /// running Tauri app -- so the source is the evidence: each command body
    /// must gate, and must gate before it awaits anything. Reading the file
    /// keeps the check honest when a tenth command is added, which a
    /// hand-maintained list of names would not.
    #[test]
    fn every_command_gates_on_the_window_label_before_doing_work() {
        // Assembled so this file contains no literal copy of the attribute
        // outside the real ones, which would split a phantom command out of
        // this very test.
        const ATTRIBUTE: &str = concat!("#[tauri::", "command]");
        let source = include_str!("mod.rs");
        let mut gated = Vec::new();

        for section in source.split(ATTRIBUTE).skip(1) {
            let (signature, rest) = section
                .split_once('{')
                .expect("a command body follows its signature");
            let name = signature
                .split("pub async fn ")
                .nth(1)
                .and_then(|tail| tail.split('(').next())
                .expect("every command is a `pub async fn`")
                .trim()
                .to_string();
            // A command's closing brace is the next one in the first column,
            // so the body never runs on into whatever follows the function.
            let body = &rest[..rest.find("\n}").unwrap_or(rest.len())];

            let gate = body
                .find("require_main_window(window.label())?;")
                .unwrap_or_else(|| panic!("{name} never gates on the window label"));
            let first_await = body.find(".await").unwrap_or(body.len());
            assert!(gate < first_await, "{name} gates only after it has awaited");
            gated.push(name);
        }

        // A tripwire, not the assertion. If this file ever stops matching what
        // the loop assumes, the sweep above would find nothing and pass.
        assert_eq!(
            gated.len(),
            9,
            "expected nine gated commands, found {gated:?}"
        );
    }
}
