import type { SupportMessageContext } from "@/lib/domain/support/types";

export type SupportReportScopeKind =
  | "most_recent_workspace"
  | "choose_workspace"
  | "app_only";

export interface SupportReportWorkspaceOption {
  id: string;
  label: string;
  location: "local" | "cloud";
  path?: string | null;
  branch?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  cloudWorkspaceId?: string | null;
  cloudTargetId?: string | null;
  sandboxProfileId?: string | null;
  anyharnessWorkspaceId?: string | null;
  exposureId?: string | null;
  materializationId?: string | null;
  sessionIds?: string[];
  visibility?: string | null;
  sandboxType?: string | null;
}

export interface SupportReportWindowSnapshot {
  openedAt: string;
  source: SupportMessageContext["source"];
  context: SupportMessageContext;
  defaultScope: SupportReportScopeKind;
  defaultWorkspaceId?: string | null;
  workspaceOptions: SupportReportWorkspaceOption[];
}

export interface SupportReportAttachmentPayload {
  clientFileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  dataBase64?: string;
  stagedPath?: string | null;
}

export interface SupportReportServerCorrelation {
  reportId: string;
  requestId?: string | null;
  ownerUserId: string;
  primaryOrganizationId?: string | null;
  primaryTenantId: string;
  tenantIds: string[];
  cloudWorkspaceIds: string[];
  cloudTargetIds: string[];
  anyharnessWorkspaceIds: string[];
  sessionIds: string[];
}

export interface SupportReportJob {
  jobId: string;
  createdAt: string;
  message: string;
  scope: {
    kind: SupportReportScopeKind;
    workspaceIds: string[];
  };
  publicContentConsent: boolean;
  kind: "bug" | "feature";
  creditConsent: boolean;
  creditName?: string | null;
  /**
   * Capture-only intent flag: the submitter marked the report as time-sensitive.
   * Optional so persisted jobs created before this field still load; defaults
   * to `false` downstream.
   */
  urgent?: boolean;
  /**
   * Capture-only intent flag: the submitter asked to be contacted about the
   * outcome. Optional for backwards-compatible persistence; defaults to `false`.
   */
  notifyMe?: boolean;
  /**
   * When `false`, diagnostics (app logs) are not collected or uploaded for this
   * report. Optional for backwards-compatible persistence; defaults to `true`
   * (logs included) so pre-existing queued jobs keep their original behavior.
   */
  includeLogs?: boolean;
  snapshot: SupportReportWindowSnapshot;
  attachments: SupportReportAttachmentPayload[];
  activeWorkspaceId?: string;
  activeSessionId?: string;
  reportOpenedAt?: string;
}
