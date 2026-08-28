use std::path::PathBuf;
use std::sync::Arc;

use base64::Engine;
use tokio::time::Duration;

use super::super::artifact_store::{
    ArtifactStoreError, ReconciledArtifactState, SupportArtifactReference, SupportArtifactStore,
    ARTIFACT_MAX_BYTES, ARTIFACT_PREFIX, MAX_ARTIFACT_REFERENCES, MAX_ATTACHMENT_REFERENCES,
};
use super::model::{
    DeleteStagedSupportSnapshotInput, ReadStagedSupportSnapshotInput,
    ReconcileStagedSupportSnapshotsInput, ReconciledSupportArtifactOutput,
    SaveSupportSnapshotArchiveInput,
};
use super::state::{
    ArtifactAuthorization, PreparationCleanup, ReadVerificationProof, ReadinessState,
    SubmissionTerminal,
};
use super::terminal::terminal_for_interruption;
use super::SupportSnapshotCoordinator;
use crate::diagnostics::support_snapshot::schema::validate::validate_id;

const RECONCILE_TIMEOUT: Duration = Duration::from_secs(10);
const READ_PROOF_LIFETIME: Duration = Duration::from_secs(30);

impl SupportSnapshotCoordinator {
    pub(crate) async fn reconcile_artifacts(
        &self,
        input: ReconcileStagedSupportSnapshotsInput,
    ) -> Result<Vec<ReconciledSupportArtifactOutput>, String> {
        if input.artifacts.len() > MAX_ARTIFACT_REFERENCES
            || input.referenced_attachment_paths.len() > MAX_ATTACHMENT_REFERENCES
            || input.artifacts.iter().any(|reference| {
                !canonical_uuid(&reference.client_job_id)
                    || validate_id(&reference.snapshot_id).is_err()
                    || !valid_artifact_id(&reference.artifact_id)
                    || SupportArtifactStore::artifact_id(&reference.client_job_id)
                        .ok()
                        .as_ref()
                        != Some(&reference.artifact_id)
                    || reference.size_bytes > ARTIFACT_MAX_BYTES
                    || !valid_sha(&reference.sha256)
            })
        {
            return Err("support_snapshot_reconcile_invalid".to_string());
        }
        let store = self
            .store
            .as_ref()
            .cloned()
            .ok_or_else(|| "support_snapshot_not_ready".to_string())?;
        let artifacts = input
            .artifacts
            .into_iter()
            .map(SupportArtifactReference::from)
            .collect::<Vec<_>>();
        {
            let mut state = self.state.lock().await;
            if state.shutdown_armed {
                return Err("support_snapshot_not_ready".to_string());
            }
            match state.readiness {
                ReadinessState::Unreconciled => state.readiness = ReadinessState::Reconciling,
                ReadinessState::Reconciling => {
                    return Err("support_snapshot_reconcile_busy".to_string())
                }
                ReadinessState::Ready => {
                    return Err("support_snapshot_already_reconciled".to_string())
                }
            }
        }
        let deadline = self.runtime.instant_now() + RECONCILE_TIMEOUT;
        let blocking_store = Arc::clone(&store);
        let result = tokio::task::spawn_blocking(move || {
            blocking_store.reconcile(
                &artifacts,
                &input.referenced_attachment_paths,
                deadline.into_std(),
            )
        })
        .await
        .map_err(|_| ArtifactStoreError::Io)
        .and_then(|result| result);
        let mut state = self.state.lock().await;
        match result {
            Ok(reconciled) if !state.shutdown_armed && self.runtime.instant_now() < deadline => {
                state.artifacts.clear();
                state.read_proofs.clear();
                for item in &reconciled {
                    if item.state == ReconciledArtifactState::Verified {
                        state.artifacts.insert(
                            item.reference.artifact_id.clone(),
                            ArtifactAuthorization {
                                reference: item.reference.clone(),
                                preparation_id: None,
                                preparation_operation_id: None,
                                consent_epoch: None,
                            },
                        );
                    }
                }
                state.readiness = ReadinessState::Ready;
                Ok(reconciled.into_iter().map(Into::into).collect())
            }
            _ => {
                state.readiness = ReadinessState::Unreconciled;
                Err("support_snapshot_reconcile_failed".to_string())
            }
        }
    }

    pub(crate) async fn read_artifact(
        &self,
        input: ReadStagedSupportSnapshotInput,
    ) -> Result<String, String> {
        if !valid_artifact_id(&input.artifact_id)
            || input.expected_size_bytes > ARTIFACT_MAX_BYTES
            || !valid_sha(&input.expected_sha256)
        {
            return Err("support_snapshot_artifact_invalid".to_string());
        }
        let store = self
            .store
            .as_ref()
            .cloned()
            .ok_or_else(|| "support_snapshot_not_ready".to_string())?;
        let reference = {
            let state = self.state.lock().await;
            if state.shutdown_armed || state.readiness != ReadinessState::Ready {
                return Err("support_snapshot_not_ready".to_string());
            }
            let reference = state
                .artifacts
                .get(&input.artifact_id)
                .map(|value| value.reference.clone())
                .ok_or_else(|| "support_snapshot_artifact_missing".to_string())?;
            if reference.size_bytes != input.expected_size_bytes
                || reference.sha256 != input.expected_sha256
            {
                return Err("support_snapshot_artifact_mismatch".to_string());
            }
            reference
        };
        let blocking_store = Arc::clone(&store);
        let blocking_reference = reference.clone();
        let bytes =
            tokio::task::spawn_blocking(move || blocking_store.read_verified(&blocking_reference))
                .await
                .map_err(|_| "support_snapshot_artifact_read_failed".to_string())?
                .map_err(map_read_error)?;
        let mut state = self.state.lock().await;
        if state.shutdown_armed {
            return Err("support_snapshot_not_ready".to_string());
        }
        let authorization = state
            .artifacts
            .get_mut(&input.artifact_id)
            .filter(|value| value.reference == reference)
            .ok_or_else(|| "support_snapshot_artifact_stale".to_string())?;
        // A verified read is the native pre-submit boundary. From this point
        // shutdown must not classify the artifact as an unqueued preparation.
        authorization.consent_epoch = None;
        state.read_proofs.insert(
            input.artifact_id,
            ReadVerificationProof {
                reference,
                expires_at: self.runtime.instant_now() + READ_PROOF_LIFETIME,
            },
        );
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    pub(crate) async fn delete_artifact(
        &self,
        input: DeleteStagedSupportSnapshotInput,
    ) -> Result<(), String> {
        if !valid_artifact_id(&input.artifact_id) {
            return Err("support_snapshot_artifact_invalid".to_string());
        }
        let store = self.store.as_ref().cloned();
        let _artifact_guard = self.artifact_gate.lock().await;
        {
            let mut state = self.state.lock().await;
            if state.shutdown_armed || state.readiness != ReadinessState::Ready {
                return Err("support_snapshot_not_ready".to_string());
            }
            if state
                .submission
                .as_ref()
                .is_some_and(|submission| submission.artifact_id == input.artifact_id)
                || state
                    .closing_submission
                    .as_ref()
                    .is_some_and(|submission| submission.artifact_id == input.artifact_id)
            {
                return Err("support_snapshot_submission_busy".to_string());
            }
            if state.artifacts.remove(&input.artifact_id).is_none() {
                // Unknown IDs are idempotent at the command boundary, but do
                // not grant filesystem deletion authority merely because the
                // deterministic leaf happens to exist.
                return Ok(());
            }
            state.read_proofs.remove(&input.artifact_id);
        }
        let Some(store) = store else {
            return Ok(());
        };
        let id = input.artifact_id;
        tokio::task::spawn_blocking(move || store.delete(&id))
            .await
            .map_err(|_| "support_snapshot_delete_failed".to_string())?
            .map_err(|_| "support_snapshot_delete_failed".to_string())
    }

    pub(crate) async fn archive_reference(
        &self,
        input: &SaveSupportSnapshotArchiveInput,
    ) -> Result<SupportArtifactReference, String> {
        if !valid_artifact_id(&input.artifact_id) || validate_id(&input.consent_epoch).is_err() {
            return Err("support_snapshot_archive_unauthorized".to_string());
        }
        let state = self.state.lock().await;
        if state.shutdown_armed || state.readiness != ReadinessState::Ready {
            return Err("support_snapshot_not_ready".to_string());
        }
        state
            .artifacts
            .get(&input.artifact_id)
            .filter(|authorization| {
                authorization.consent_epoch.as_deref() == Some(&input.consent_epoch)
            })
            .map(|authorization| authorization.reference.clone())
            .ok_or_else(|| "support_snapshot_archive_unauthorized".to_string())
    }

    pub(crate) async fn save_archive_to(
        &self,
        reference: SupportArtifactReference,
        output_path: PathBuf,
    ) -> Result<(), String> {
        let store = self
            .store
            .as_ref()
            .cloned()
            .ok_or_else(|| "support_snapshot_not_ready".to_string())?;
        tokio::task::spawn_blocking(move || store.save_archive(&reference, &output_path))
            .await
            .map_err(|_| "support_snapshot_archive_failed".to_string())?
            .map_err(|_| "support_snapshot_archive_failed".to_string())
    }

    pub(super) async fn delete_artifacts(&self, artifact_ids: Vec<String>) {
        let Some(store) = self.store.as_ref().cloned() else {
            return;
        };
        let _ = tokio::task::spawn_blocking(move || {
            for artifact_id in artifact_ids {
                let _ = store.delete(&artifact_id);
            }
        })
        .await;
    }

    pub(crate) async fn cancel_support(self: &Arc<Self>) {
        let _shutdown_guard = self.shutdown_gate.lock().await;
        let (closing_preparation, closing_submission, deletes) = {
            let mut state = self.state.lock().await;
            state.shutdown_armed = true;
            let open = state.preparation.as_ref().map(|open| {
                (
                    open.preparation_id.clone(),
                    open.deadline,
                    Arc::clone(&open.control),
                )
            });
            let closing = if let Some((preparation_id, deadline, control)) = open {
                if self.runtime.instant_now() >= deadline {
                    control.request(super::control::PreparationInterruption::Deadline);
                }
                control.request(super::control::PreparationInterruption::Abandoned);
                state.transfer_preparation_to_closing(
                    &preparation_id,
                    terminal_for_interruption(control.interruption()),
                    PreparationCleanup::Interrupted,
                )
            } else {
                state.closing_preparation.clone()
            };
            let submission_id = state
                .submission
                .as_ref()
                .map(|submission| submission.submission_id.clone());
            let closing_submission = if let Some(submission_id) = submission_id {
                state.transfer_submission_to_closing(&submission_id, SubmissionTerminal::Abandoned)
            } else {
                state.closing_submission.clone()
            };
            let deletes = state
                .artifacts
                .iter()
                .filter(|(_, authorization)| authorization.consent_epoch.is_some())
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in &deletes {
                state.artifacts.remove(id);
                state.read_proofs.remove(id);
            }
            (closing, closing_submission, deletes)
        };

        if let Some(closing) = &closing_preparation {
            self.spawn_closing_owner(Arc::clone(closing));
        }
        if let Some(closing) = &closing_submission {
            self.spawn_closing_submission_owner(Arc::clone(closing));
        }
        if let Some(closing) = closing_preparation {
            closing.wait_completed().await;
        }
        if let Some(closing) = closing_submission {
            closing.wait_completed().await;
        }
        if !deletes.is_empty() {
            let _artifact_guard = self.artifact_gate.lock().await;
            self.delete_artifacts(deletes).await;
        }
    }
}

fn valid_sha(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

pub(super) fn valid_artifact_id(value: &str) -> bool {
    value.strip_prefix(ARTIFACT_PREFIX).is_some_and(valid_sha)
}

fn canonical_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .ok()
        .is_some_and(|parsed| parsed.to_string() == value)
}

fn map_read_error(error: ArtifactStoreError) -> String {
    match error {
        ArtifactStoreError::Missing => "support_snapshot_artifact_missing",
        ArtifactStoreError::Mismatch | ArtifactStoreError::ArtifactVerificationFailed => {
            "support_snapshot_artifact_mismatch"
        }
        _ => "support_snapshot_artifact_read_failed",
    }
    .to_string()
}
