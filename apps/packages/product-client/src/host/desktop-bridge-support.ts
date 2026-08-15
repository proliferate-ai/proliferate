// --- Diagnostics and support ------------------------------------------------

export interface SaveJsonInput {
  suggestedFileName: string;
  contents: string;
}

export interface AttachmentInput {
  clientFileId: string;
  fileName: string;
  dataBase64: string;
}

/**
 * A React render-phase error captured by the product's AppErrorBoundary and
 * forwarded to Desktop's renderer diagnostics producer. The host
 * owns dedup/fingerprint/suppression semantics so the product boundary stays a
 * thin reporter. `error` crosses the boundary as-is; the host derives its
 * message/stack.
 */
export interface RenderErrorReport {
  error: unknown;
  componentStack?: string | null;
}

// --- Consented support snapshot ----------------------------------------------

export type SupportSnapshotWorkspaceBindingV1 =
  | {
      kind: "bundled_local";
      workspaceId: string; // ProductClient logical workspace ID
      anyharnessWorkspaceId: string;
    }
  | {
      kind: "none";
      reason: "no_selected_bundled_local_workspace";
    };

export type SupportSnapshotSelectionV1 =
  | {
      kind: "active_session";
      workspace: Extract<SupportSnapshotWorkspaceBindingV1, { kind: "bundled_local" }>;
      uiSessionId: string;
      materializedSessionId: string;
    }
  | {
      kind: "recent_activity";
      workspace: SupportSnapshotWorkspaceBindingV1;
    };

export interface SupportSnapshotConsentV1 {
  version: 1;
  disclosureVersion: "desktop_support_snapshot_customer_content_v1";
  grantedAt: string;
  selection: SupportSnapshotSelectionV1;
}

export interface SupportSnapshotWindowV1 {
  sourceTimeFrom: string;
  sourceTimeTo: string;
}

export interface SupportSnapshotPreparation {
  preparationId: string;
  preparationOperationId: string;
  capturedAt: string;
  window: SupportSnapshotWindowV1;
}

export interface PreparedSupportSnapshotV1 {
  artifactSchemaVersion: 3;
  artifactId: string;
  snapshotId: string;
  preparationOperationId: string;
  generatedAt: string;
  sizeBytes: number;
  sha256: string;
  summary: {
    collectorRecords: number;
    fallbackRecords: number;
    sessions: number;
    omissions: number;
    truncations: number;
  };
}

export interface PersistedSupportArtifactRefV1 {
  clientJobId: string;
  artifactId: string;
  snapshotId: string;
  sizeBytes: number;
  sha256: string;
}

export type ReconciledSupportArtifactV1 = PersistedSupportArtifactRefV1 & {
  state: "verified" | "missing" | "mismatch";
};

export type SupportSessionCollectionManifestV1 =
  | {
      state: "included";
      workspaceId: string;
      anyharnessWorkspaceId: string;
      selectedSessions: number;
      sessionIncludedBytes: number;
      eventIncludedBytes: number;
      rawNotificationIncludedBytes: number;
      limitUncertainEndpoints: number;
    }
  | {
      state: "omitted";
      reason: "no_selected_bundled_local_workspace" | "session_unavailable"
        | "session_timeout" | "session_invalid";
    };

export interface BeginSupportSnapshotInput {
  clientJobId: string;
  reportOpenedAt: string;
  consentEpoch: string;
  consent: SupportSnapshotConsentV1;
}

export interface FinishSupportSnapshotInput {
  preparationId: string;
  consentEpoch: string;
  sessionEvidenceJson: string | null; // UTF-8 JSON at most 8,388,608 bytes; null when omitted
  sessionCollection: SupportSessionCollectionManifestV1;
}

export type SupportSnapshotAttemptOutcome =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "abandoned"
  | "rejected";

export type SupportSnapshotPreparationFailureClassificationV1 =
  | "preparation_timeout"
  | "preparation_rejected"
  | "scrub_failed"
  | "manifest_invalid"
  | "stage_failed"
  | "artifact_verification_failed";

export type SupportSnapshotSubmissionRejectedClassificationV1 =
  | "local_payload_invalid"
  | "upload_conflict"
  | "upload_rejected";

export type SupportSnapshotSubmissionFailedClassificationV1 =
  | "auth_required"
  | "cloud_unconfigured"
  | "dev_auth_bypass"
  | "storage_unconfigured"
  | "transient";

export type FinishSupportSnapshotSubmissionInputV1 =
  | {
      submissionId: string;
      outcome: "succeeded" | "cancelled" | "abandoned";
      errorClassification?: never;
      reportId?: string | null;
    }
  | {
      submissionId: string;
      outcome: "timed_out";
      errorClassification: "upload_timeout";
      reportId?: string | null;
    }
  | {
      submissionId: string;
      outcome: "rejected";
      errorClassification: SupportSnapshotSubmissionRejectedClassificationV1;
      reportId?: string | null;
    }
  | {
      submissionId: string;
      outcome: "failed";
      errorClassification: SupportSnapshotSubmissionFailedClassificationV1;
      reportId?: string | null;
    };

/**
 * The consented support-snapshot boundary. Every method is support-specific:
 * no raw export request, collector endpoint/capability/reference, support
 * permit/authorization material, arbitrary filesystem path, arbitrary
 * lifecycle name, raw record payload, or unbounded JSON value crosses it.
 * Artifact IDs are durable job-bound opaque handles, never paths.
 */
export interface DesktopSupportSnapshotBridge {
  beginPreparation(input: BeginSupportSnapshotInput): Promise<SupportSnapshotPreparation>;
  finishPreparation(input: FinishSupportSnapshotInput): Promise<PreparedSupportSnapshotV1>;
  cancelPreparation(input: {
    clientJobId: string;
    consentEpoch: string;
    preparationId?: string;
  }): Promise<void>;
  saveArchive(input: { artifactId: string; consentEpoch: string }): Promise<string | null>;
  readArtifact(input: {
    artifactId: string;
    expectedSizeBytes: number;
    expectedSha256: string;
  }): Promise<string>; // base64, same bounded pattern as current staged attachments
  deleteArtifact(artifactId: string): Promise<void>;
  reconcileArtifacts(input: {
    artifacts: PersistedSupportArtifactRefV1[]; // at most ten
    referencedAttachmentPaths: string[]; // bounded by ten jobs and existing attachment cap
  }): Promise<ReconciledSupportArtifactV1[]>;
  beginSubmission(input: {
    artifactId: string;
    clientJobId: string;
    attempt: number;
    parentOperationId: string;
  }): Promise<{ submissionId: string; operationId: string }>;
  finishSubmission(input: FinishSupportSnapshotSubmissionInputV1): Promise<void>;
}
