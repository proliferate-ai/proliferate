use serde::{Deserialize, Serialize};

use super::super::artifact_store::{
    ReconciledArtifactState, ReconciledSupportArtifact, StoredSupportArtifact,
    SupportArtifactReference,
};
use super::super::schema::model::manifest::SupportSessionCollectionManifestV1;

pub(super) const DISCLOSURE_VERSION: &str = "desktop_support_snapshot_customer_content_v1";
pub(super) const SESSION_EVIDENCE_BYTES: usize = 8_388_608;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BeginSupportSnapshotInput {
    pub client_job_id: String,
    pub report_opened_at: String,
    pub consent_epoch: String,
    pub consent: SupportSnapshotConsentInput,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SupportSnapshotConsentInput {
    pub version: u8,
    pub disclosure_version: String,
    pub granted_at: String,
    pub selection: SupportSnapshotSelectionInput,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum SupportSnapshotSelectionInput {
    #[serde(rename_all = "camelCase")]
    ActiveSession {
        workspace: BundledLocalWorkspaceInput,
        ui_session_id: String,
        materialized_session_id: String,
    },
    #[serde(rename_all = "camelCase")]
    RecentActivity {
        workspace: SupportSnapshotWorkspaceInput,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum SupportSnapshotWorkspaceInput {
    #[serde(rename_all = "camelCase")]
    BundledLocal {
        workspace_id: String,
        anyharness_workspace_id: String,
    },
    None {
        reason: NoWorkspaceReason,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BundledLocalWorkspaceInput {
    pub kind: BundledLocalKind,
    pub workspace_id: String,
    pub anyharness_workspace_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BundledLocalKind {
    BundledLocal,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NoWorkspaceReason {
    NoSelectedBundledLocalWorkspace,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FinishSupportSnapshotInput {
    pub preparation_id: String,
    pub consent_epoch: String,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub session_evidence_json: Option<String>,
    pub session_collection: SupportSessionCollectionManifestV1,
}

fn deserialize_required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CancelSupportSnapshotInput {
    pub client_job_id: String,
    pub consent_epoch: String,
    pub preparation_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveSupportSnapshotArchiveInput {
    pub artifact_id: String,
    pub consent_epoch: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadStagedSupportSnapshotInput {
    pub artifact_id: String,
    pub expected_size_bytes: u64,
    pub expected_sha256: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteStagedSupportSnapshotInput {
    pub artifact_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PersistedSupportArtifactRefInput {
    pub client_job_id: String,
    pub artifact_id: String,
    pub snapshot_id: String,
    pub size_bytes: u64,
    pub sha256: String,
}

impl From<PersistedSupportArtifactRefInput> for SupportArtifactReference {
    fn from(value: PersistedSupportArtifactRefInput) -> Self {
        Self {
            client_job_id: value.client_job_id,
            artifact_id: value.artifact_id,
            snapshot_id: value.snapshot_id,
            size_bytes: value.size_bytes,
            sha256: value.sha256,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReconcileStagedSupportSnapshotsInput {
    pub artifacts: Vec<PersistedSupportArtifactRefInput>,
    pub referenced_attachment_paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BeginSupportSnapshotSubmissionInput {
    pub artifact_id: String,
    pub client_job_id: String,
    pub attempt: u64,
    pub parent_operation_id: String,
}

#[derive(Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum FinishSupportSnapshotSubmissionInput {
    #[serde(rename_all = "camelCase")]
    Succeeded {
        submission_id: String,
        report_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Cancelled {
        submission_id: String,
        report_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Abandoned {
        submission_id: String,
        report_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    TimedOut {
        submission_id: String,
        error_classification: UploadTimeoutClassificationInput,
        report_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Rejected {
        submission_id: String,
        error_classification: SubmissionRejectedClassificationInput,
        report_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        submission_id: String,
        error_classification: SubmissionFailedClassificationInput,
        report_id: Option<String>,
    },
}

impl FinishSupportSnapshotSubmissionInput {
    pub(super) fn submission_id(&self) -> &str {
        match self {
            Self::Succeeded { submission_id, .. }
            | Self::Cancelled { submission_id, .. }
            | Self::Abandoned { submission_id, .. }
            | Self::TimedOut { submission_id, .. }
            | Self::Rejected { submission_id, .. }
            | Self::Failed { submission_id, .. } => submission_id,
        }
    }

    pub(super) fn report_id(&self) -> Option<&str> {
        match self {
            Self::Succeeded { report_id, .. }
            | Self::Cancelled { report_id, .. }
            | Self::Abandoned { report_id, .. }
            | Self::TimedOut { report_id, .. }
            | Self::Rejected { report_id, .. }
            | Self::Failed { report_id, .. } => report_id.as_deref(),
        }
    }
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum UploadTimeoutClassificationInput {
    UploadTimeout,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SubmissionRejectedClassificationInput {
    LocalPayloadInvalid,
    UploadConflict,
    UploadRejected,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SubmissionFailedClassificationInput {
    AuthRequired,
    CloudUnconfigured,
    DevAuthBypass,
    StorageUnconfigured,
    Transient,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupportSnapshotWindowOutput {
    pub source_time_from: String,
    pub source_time_to: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupportSnapshotPreparationOutput {
    pub preparation_id: String,
    pub preparation_operation_id: String,
    pub captured_at: String,
    pub window: SupportSnapshotWindowOutput,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedSupportSnapshotSummaryOutput {
    pub collector_records: u64,
    pub fallback_records: u64,
    pub sessions: u64,
    pub omissions: u64,
    pub truncations: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedSupportSnapshotOutput {
    pub artifact_schema_version: u64,
    pub artifact_id: String,
    pub snapshot_id: String,
    pub preparation_operation_id: String,
    pub generated_at: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub summary: PreparedSupportSnapshotSummaryOutput,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReconciledSupportArtifactOutput {
    pub client_job_id: String,
    pub artifact_id: String,
    pub snapshot_id: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub state: ReconciledArtifactStateOutput,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ReconciledArtifactStateOutput {
    Verified,
    Missing,
    Mismatch,
}

impl From<ReconciledSupportArtifact> for ReconciledSupportArtifactOutput {
    fn from(value: ReconciledSupportArtifact) -> Self {
        let reference = value.reference;
        Self {
            client_job_id: reference.client_job_id,
            artifact_id: reference.artifact_id,
            snapshot_id: reference.snapshot_id,
            size_bytes: reference.size_bytes,
            sha256: reference.sha256,
            state: match value.state {
                ReconciledArtifactState::Verified => ReconciledArtifactStateOutput::Verified,
                ReconciledArtifactState::Missing => ReconciledArtifactStateOutput::Missing,
                ReconciledArtifactState::Mismatch => ReconciledArtifactStateOutput::Mismatch,
            },
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BeginSupportSnapshotSubmissionOutput {
    pub submission_id: String,
    pub operation_id: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveSupportSnapshotArchiveOutput {
    pub archive_name: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadStagedSupportSnapshotOutput {
    pub data_base64: String,
}

pub(super) fn reference_from_stored(stored: &StoredSupportArtifact) -> SupportArtifactReference {
    SupportArtifactReference {
        client_job_id: stored.client_job_id.clone(),
        artifact_id: stored.artifact_id.clone(),
        snapshot_id: stored.snapshot_id.clone(),
        size_bytes: stored.size_bytes,
        sha256: stored.sha256.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nullable_session_evidence_is_required_and_submission_is_discriminated() {
        let missing_session_evidence = serde_json::json!({
            "preparationId": uuid::Uuid::new_v4().to_string(),
            "consentEpoch": "epoch-1",
            "sessionCollection": { "state": "omitted", "reason": "session_invalid" }
        });
        assert!(
            serde_json::from_value::<FinishSupportSnapshotInput>(missing_session_evidence).is_err()
        );

        let nullable_session_evidence = serde_json::json!({
            "preparationId": uuid::Uuid::new_v4().to_string(),
            "consentEpoch": "epoch-1",
            "sessionEvidenceJson": null,
            "sessionCollection": { "state": "omitted", "reason": "session_invalid" }
        });
        assert!(
            serde_json::from_value::<FinishSupportSnapshotInput>(nullable_session_evidence).is_ok()
        );

        let submission_id = uuid::Uuid::new_v4().to_string();
        assert!(
            serde_json::from_value::<FinishSupportSnapshotSubmissionInput>(serde_json::json!({
                "submissionId": submission_id,
                "outcome": "timed_out"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<FinishSupportSnapshotSubmissionInput>(serde_json::json!({
                "submissionId": uuid::Uuid::new_v4().to_string(),
                "outcome": "succeeded",
                "errorClassification": "upload_timeout"
            }))
            .is_err()
        );
    }

    #[test]
    fn command_receipts_serialize_only_the_display_name_and_base64() {
        assert_eq!(
            serde_json::to_value(SaveSupportSnapshotArchiveOutput {
                archive_name: "snapshot.zip".to_string(),
            })
            .expect("archive receipt"),
            serde_json::json!({ "archiveName": "snapshot.zip" })
        );
        assert_eq!(
            serde_json::to_value(ReadStagedSupportSnapshotOutput {
                data_base64: "AA==".to_string(),
            })
            .expect("read receipt"),
            serde_json::json!({ "dataBase64": "AA==" })
        );
    }
}
