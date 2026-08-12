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
    ArtifactAuthorization, ClosingPreparation, ReadVerificationProof, ReadinessState,
};
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

    pub(crate) async fn cancel_support(&self) {
        let _shutdown_guard = self.shutdown_gate.lock().await;
        let (preparation, control, submission, mut deletes) = {
            let mut state = self.state.lock().await;
            state.shutdown_armed = true;
            let preparation = state.preparation.take();
            let preparation = preparation.map(|open| {
                if self.runtime.instant_now() >= open.deadline {
                    open.control
                        .request(super::control::PreparationInterruption::Deadline);
                }
                open.control
                    .request(super::control::PreparationInterruption::Abandoned);
                let control = Arc::clone(&open.control);
                let artifact_id = SupportArtifactStore::artifact_id(&open.input.client_job_id).ok();
                let operation = open.operation;
                state.closing_preparation = artifact_id.map(|artifact_id| ClosingPreparation {
                    control: Arc::clone(&control),
                    artifact_id,
                });
                (operation, control)
            });
            let submission = state
                .submission
                .take()
                .and_then(|mut open| open.operation.take());
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
            let (preparation, control) = match preparation {
                Some((operation, control)) => (Some(operation), Some(control)),
                None => (
                    None,
                    state
                        .closing_preparation
                        .as_ref()
                        .map(|closing| Arc::clone(&closing.control)),
                ),
            };
            (preparation, control, submission, deletes)
        };
        if let Some(control) = &control {
            control.wait_idle().await;
        }
        if let Some(success) = control
            .as_ref()
            .and_then(|control| control.finish_completion().claim_cleanup())
        {
            if !deletes.contains(&success.reference.artifact_id) {
                deletes.push(success.reference.artifact_id);
            }
        }
        if let (Some(preparation), Some(control)) = (preparation.as_ref(), control.as_ref()) {
            super::terminal::terminal_for_interruption(preparation, control.interruption());
        }
        if let Some(submission) = submission {
            submission.abandoned();
        }
        let detached_artifact = self
            .state
            .lock()
            .await
            .closing_preparation
            .as_ref()
            .map(|closing| closing.artifact_id.clone());
        // A detached finisher can stage only this deterministic job-bound
        // artifact. Delete it after the shared work fence, even when no
        // command future remains to consume the FinishResult.
        if let Some(artifact_id) = detached_artifact {
            if !deletes.contains(&artifact_id) {
                deletes.push(artifact_id);
            }
        }
        // Serialize every reentrant shutdown through the same publication /
        // cleanup gate. No caller can return while another still owns final
        // staged-artifact deletion.
        let _artifact_guard = self.artifact_gate.lock().await;
        self.delete_artifacts(deletes).await;
        let mut state = self.state.lock().await;
        if control.as_ref().is_some_and(|control| {
            state
                .closing_preparation
                .as_ref()
                .is_some_and(|closing| Arc::ptr_eq(&closing.control, control))
        }) {
            state.closing_preparation = None;
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
    value
        .strip_prefix(ARTIFACT_PREFIX)
        .is_some_and(|digest| valid_sha(digest))
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
