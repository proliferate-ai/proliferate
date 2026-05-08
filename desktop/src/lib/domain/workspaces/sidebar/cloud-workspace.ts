export type SidebarCloudWorkspaceStatus =
  | "pending"
  | "materializing"
  | "ready"
  | "archived"
  | "error";

export type SidebarCloudRuntimeStatus =
  | "pending"
  | "provisioning"
  | "running"
  | "paused"
  | "error"
  | "disabled";

export interface SidebarCloudWorkspaceRepoRef {
  provider: string;
  owner: string;
  name: string;
  branch: string;
  baseBranch: string;
}

export type SidebarCloudWorkspaceOriginContext = {
  kind: "human" | "cowork" | "api" | "system";
  entrypoint: "desktop" | "cloud" | "local_runtime" | "cowork";
} | null | undefined;

export type SidebarCloudWorkspaceCreatorContext =
  | {
    kind: "human";
    label?: string | null;
  }
  | {
    kind: "automation";
    automationId?: string | null;
    automationRunId?: string | null;
    label?: string | null;
  }
  | {
    kind: "agent";
    sourceSessionId?: string | null;
    sourceSessionWorkspaceId?: string | null;
    sessionLinkId?: string | null;
    sourceWorkspaceId?: string | null;
    label?: string | null;
  };

export interface SidebarCloudWorkspaceRuntimeSummary {
  environmentId: string | null;
  status: SidebarCloudRuntimeStatus;
  generation: number;
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
}

export interface SidebarCloudWorkspaceSummary {
  id: string;
  displayName: string | null;
  repo: SidebarCloudWorkspaceRepoRef;
  status: SidebarCloudWorkspaceStatus;
  workspaceStatus: SidebarCloudWorkspaceStatus;
  runtime?: SidebarCloudWorkspaceRuntimeSummary;
  statusDetail: string | null;
  lastError: string | null;
  templateVersion: string | null;
  actionBlockKind?: string | null;
  actionBlockReason?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  postReadyPhase: string;
  postReadyFilesTotal: number;
  postReadyFilesApplied: number;
  postReadyStartedAt: string | null;
  postReadyCompletedAt: string | null;
  origin?: SidebarCloudWorkspaceOriginContext;
  creatorContext?: SidebarCloudWorkspaceCreatorContext | null;
}
