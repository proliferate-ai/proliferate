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

export interface SupportReportJob {
  jobId: string;
  createdAt: string;
  message: string;
  scope: {
    kind: SupportReportScopeKind;
    workspaceIds: string[];
  };
  snapshot: SupportReportWindowSnapshot;
  attachments: SupportReportAttachmentPayload[];
}
