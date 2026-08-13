use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex as StdMutex,
};
use tokio::sync::Notify;
use tokio::time::Instant;

use crate::diagnostics_collector::producer::lifecycle::support_lifecycle::{
    SupportPreparationOperation, SupportSubmissionOperation,
};

use super::super::artifact_store::{SupportArtifactReference, SupportArtifactStore};
use super::capture::CapturedNativeSupportEvidence;
use super::control::{PreparationControl, PreparationInterruption};
use super::model::BeginSupportSnapshotInput;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ReadinessState {
    Unreconciled,
    Reconciling,
    Ready,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PreparationPhase {
    Capturing,
    AwaitingFinish,
    Finishing,
}

pub(super) struct OpenPreparation {
    pub input: BeginSupportSnapshotInput,
    pub preparation_id: String,
    pub snapshot_id: String,
    pub preparation_operation_id: String,
    pub captured_at: String,
    pub source_time_from: String,
    pub source_time_to: String,
    pub deadline: Instant,
    pub phase: PreparationPhase,
    pub control: Arc<PreparationControl>,
    pub operation: Arc<StdMutex<Option<SupportPreparationOperation>>>,
    pub captured: Option<CapturedNativeSupportEvidence>,
    pub session_phase_started_at: Option<String>,
}

pub(super) struct OpenSubmission {
    pub submission_id: String,
    pub artifact_id: String,
    pub client_job_id: String,
    pub operation: Option<SupportSubmissionOperation>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ClosedPreparation {
    pub preparation_id: String,
    pub consent_epoch: String,
    pub interruption: PreparationInterruption,
}

#[derive(Clone)]
pub(super) struct ArtifactAuthorization {
    pub reference: SupportArtifactReference,
    pub preparation_id: Option<String>,
    pub preparation_operation_id: Option<String>,
    pub consent_epoch: Option<String>,
}

#[derive(Clone)]
pub(super) struct ReadVerificationProof {
    pub reference: SupportArtifactReference,
    pub expires_at: Instant,
}

pub(super) struct CoordinatorState {
    pub shutdown_armed: bool,
    pub readiness: ReadinessState,
    pub preparation: Option<OpenPreparation>,
    pub closing_preparation: Option<Arc<ClosingPreparation>>,
    pub closed_preparation: Option<ClosedPreparation>,
    pub submission: Option<OpenSubmission>,
    pub artifacts: BTreeMap<String, ArtifactAuthorization>,
    pub read_proofs: BTreeMap<String, ReadVerificationProof>,
}

impl Default for CoordinatorState {
    fn default() -> Self {
        Self {
            shutdown_armed: false,
            readiness: ReadinessState::Unreconciled,
            preparation: None,
            closing_preparation: None,
            closed_preparation: None,
            submission: None,
            artifacts: BTreeMap::new(),
            read_proofs: BTreeMap::new(),
        }
    }
}

pub(super) struct ClosingPreparation {
    pub preparation_id: String,
    pub consent_epoch: String,
    pub client_job_id: String,
    pub interruption: PreparationInterruption,
    pub control: Arc<PreparationControl>,
    pub operation: Arc<StdMutex<Option<SupportPreparationOperation>>>,
    pub artifact_id: String,
    owner_claimed: AtomicBool,
    completed: AtomicBool,
    completion: Notify,
}

impl CoordinatorState {
    pub fn purge_expired_proofs(&mut self, now: Instant) {
        self.read_proofs.retain(|_, proof| proof.expires_at > now);
    }

    pub fn transfer_preparation_to_closing(
        &mut self,
        preparation_id: &str,
    ) -> Option<Arc<ClosingPreparation>> {
        if let Some(closing) = self
            .closing_preparation
            .as_ref()
            .filter(|closing| closing.preparation_id == preparation_id)
        {
            return Some(Arc::clone(closing));
        }
        let matches = self
            .preparation
            .as_ref()
            .is_some_and(|open| open.preparation_id == preparation_id);
        if !matches {
            return None;
        }
        let open = self.preparation.take().expect("matching preparation");
        let interruption = open.control.interruption();
        debug_assert_ne!(interruption, PreparationInterruption::Running);
        let artifact_id = SupportArtifactStore::artifact_id(&open.input.client_job_id)
            .expect("admitted client job id is canonical");
        self.closed_preparation = Some(ClosedPreparation {
            preparation_id: open.preparation_id.clone(),
            consent_epoch: open.input.consent_epoch.clone(),
            interruption,
        });
        let closing = Arc::new(ClosingPreparation {
            preparation_id: open.preparation_id,
            consent_epoch: open.input.consent_epoch,
            client_job_id: open.input.client_job_id,
            interruption,
            control: open.control,
            operation: open.operation,
            artifact_id,
            owner_claimed: AtomicBool::new(false),
            completed: AtomicBool::new(false),
            completion: Notify::new(),
        });
        self.closing_preparation = Some(Arc::clone(&closing));
        Some(closing)
    }
}

impl ClosingPreparation {
    pub fn claim_owner(&self) -> bool {
        !self.owner_claimed.swap(true, Ordering::AcqRel)
    }

    pub async fn wait_completed(&self) {
        loop {
            let notified = self.completion.notified();
            if self.completed.load(Ordering::Acquire) {
                return;
            }
            notified.await;
        }
    }

    pub fn complete(&self) {
        self.completed.store(true, Ordering::Release);
        self.completion.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readiness_starts_fail_closed() {
        let state = CoordinatorState::default();
        assert_eq!(state.readiness, ReadinessState::Unreconciled);
        assert!(!state.shutdown_armed);
        assert!(state.preparation.is_none());
        assert!(state.submission.is_none());
    }

    #[test]
    fn expired_read_proofs_are_removed_without_touching_artifacts() {
        let mut state = CoordinatorState::default();
        let reference = SupportArtifactReference {
            client_job_id: uuid::Uuid::new_v4().to_string(),
            artifact_id: format!("ssv1_{}", "a".repeat(64)),
            snapshot_id: "snapshot".to_string(),
            size_bytes: 1,
            sha256: "b".repeat(64),
        };
        let now = Instant::now();
        state.read_proofs.insert(
            reference.artifact_id.clone(),
            ReadVerificationProof {
                reference,
                expires_at: now,
            },
        );
        state.purge_expired_proofs(now);
        assert!(state.read_proofs.is_empty());
    }
}
