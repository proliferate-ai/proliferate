use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex as StdMutex,
};
use tokio::sync::watch;
use tokio::time::Instant;

use crate::diagnostics_collector::producer::lifecycle::support_lifecycle::{
    SupportPreparationOperation, SupportSnapshotPreparationFailureClassificationV1,
    SupportSnapshotSubmissionFailedClassificationV1,
    SupportSnapshotSubmissionRejectedClassificationV1, SupportSubmissionOperation,
};

use super::super::artifact_store::{SupportArtifactReference, SupportArtifactStore};
use super::capture::CapturedNativeSupportEvidence;
use super::control::{PreparationControl, PreparationInterruption};
use super::model::BeginSupportSnapshotInput;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReadinessState {
    Unreconciled,
    Reconciling,
    Ready,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PreparationPhase {
    Capturing,
    AwaitingFinish,
    Finishing,
}

pub(crate) struct OpenPreparation {
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

pub(crate) struct OpenSubmission {
    pub submission_id: String,
    pub artifact_id: String,
    pub client_job_id: String,
    pub operation: Option<SupportSubmissionOperation>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ClosedPreparation {
    pub preparation_id: String,
    pub consent_epoch: String,
    pub interruption: PreparationInterruption,
}

#[derive(Clone)]
pub(crate) struct ArtifactAuthorization {
    pub reference: SupportArtifactReference,
    pub preparation_id: Option<String>,
    pub preparation_operation_id: Option<String>,
    pub consent_epoch: Option<String>,
}

#[derive(Clone)]
pub(crate) struct ReadVerificationProof {
    pub reference: SupportArtifactReference,
    pub expires_at: Instant,
}

pub(crate) struct CoordinatorState {
    pub shutdown_armed: bool,
    pub readiness: ReadinessState,
    pub preparation: Option<OpenPreparation>,
    pub closing_preparation: Option<Arc<ClosingPreparation>>,
    pub closed_preparation: Option<ClosedPreparation>,
    pub submission: Option<OpenSubmission>,
    pub closing_submission: Option<Arc<ClosingSubmission>>,
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
            closing_submission: None,
            artifacts: BTreeMap::new(),
            read_proofs: BTreeMap::new(),
        }
    }
}

pub(crate) struct ClosingPreparation {
    pub preparation_id: String,
    pub consent_epoch: String,
    pub client_job_id: String,
    pub interruption: PreparationInterruption,
    pub control: Arc<PreparationControl>,
    pub operation: Arc<StdMutex<Option<SupportPreparationOperation>>>,
    pub artifact_id: String,
    pub terminal: PreparationTerminal,
    pub cleanup: PreparationCleanup,
    owner_claimed: AtomicBool,
    completion: watch::Sender<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PreparationTerminal {
    Succeeded,
    Cancelled,
    Abandoned,
    Failed(SupportSnapshotPreparationFailureClassificationV1),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PreparationCleanup {
    None,
    Interrupted,
    StagedArtifact,
}

pub(crate) struct ClosingSubmission {
    pub submission_id: String,
    pub artifact_id: String,
    pub operation: Arc<StdMutex<Option<SupportSubmissionOperation>>>,
    pub terminal: SubmissionTerminal,
    owner_claimed: AtomicBool,
    completion: watch::Sender<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SubmissionTerminal {
    Succeeded,
    Cancelled,
    Abandoned,
    TimedOut,
    Rejected(SupportSnapshotSubmissionRejectedClassificationV1),
    Failed(SupportSnapshotSubmissionFailedClassificationV1),
}

impl CoordinatorState {
    pub fn purge_expired_proofs(&mut self, now: Instant) {
        self.read_proofs.retain(|_, proof| proof.expires_at > now);
    }

    pub fn transfer_preparation_to_closing(
        &mut self,
        preparation_id: &str,
        terminal: PreparationTerminal,
        cleanup: PreparationCleanup,
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
        let artifact_id = SupportArtifactStore::artifact_id(&open.input.client_job_id)
            .expect("admitted client job id is canonical");
        self.closed_preparation =
            (interruption != PreparationInterruption::Running).then(|| ClosedPreparation {
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
            terminal,
            cleanup,
            owner_claimed: AtomicBool::new(false),
            completion: watch::channel(false).0,
        });
        self.closing_preparation = Some(Arc::clone(&closing));
        Some(closing)
    }

    pub fn transfer_submission_to_closing(
        &mut self,
        submission_id: &str,
        terminal: SubmissionTerminal,
    ) -> Option<Arc<ClosingSubmission>> {
        if let Some(closing) = self
            .closing_submission
            .as_ref()
            .filter(|closing| closing.submission_id == submission_id)
        {
            return Some(Arc::clone(closing));
        }
        let matches = self
            .submission
            .as_ref()
            .is_some_and(|open| open.submission_id == submission_id);
        if !matches {
            return None;
        }
        let mut open = self.submission.take().expect("matching submission");
        let operation = open
            .operation
            .take()
            .expect("admitted submission operation");
        let closing = Arc::new(ClosingSubmission {
            submission_id: open.submission_id,
            artifact_id: open.artifact_id,
            operation: Arc::new(StdMutex::new(Some(operation))),
            terminal,
            owner_claimed: AtomicBool::new(false),
            completion: watch::channel(false).0,
        });
        self.closing_submission = Some(Arc::clone(&closing));
        Some(closing)
    }
}

impl ClosingPreparation {
    pub fn claim_owner(&self) -> bool {
        !self.owner_claimed.swap(true, Ordering::AcqRel)
    }

    pub async fn wait_completed(&self) {
        let mut completion = self.completion.subscribe();
        loop {
            if *completion.borrow() {
                return;
            }
            if completion.changed().await.is_err() {
                return;
            }
        }
    }

    pub fn complete(&self) {
        self.completion.send_replace(true);
    }
}

impl ClosingSubmission {
    pub fn claim_owner(&self) -> bool {
        !self.owner_claimed.swap(true, Ordering::AcqRel)
    }

    pub async fn wait_completed(&self) {
        let mut completion = self.completion.subscribe();
        loop {
            if *completion.borrow() {
                return;
            }
            if completion.changed().await.is_err() {
                return;
            }
        }
    }

    pub fn complete(&self) {
        self.completion.send_replace(true);
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
        assert!(state.closing_preparation.is_none());
        assert!(state.closing_submission.is_none());
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
