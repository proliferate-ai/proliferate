import type {
  CloudRuntimeStatus,
  CloudWorkspaceCreatorContext,
  CloudWorkspaceOriginContext,
  CloudWorkspaceRepoRef,
  CloudWorkspaceRuntimeSummary,
  CloudWorkspaceStatus,
  CloudWorkspaceSummary,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-model";

export type SidebarCloudWorkspaceStatus = CloudWorkspaceStatus;
export type SidebarCloudRuntimeStatus = CloudRuntimeStatus;
export type SidebarCloudWorkspaceRepoRef = CloudWorkspaceRepoRef;
export type SidebarCloudWorkspaceOriginContext = CloudWorkspaceOriginContext | null | undefined;
export type SidebarCloudWorkspaceCreatorContext = CloudWorkspaceCreatorContext;
export type SidebarCloudWorkspaceRuntimeSummary = CloudWorkspaceRuntimeSummary;
export type SidebarCloudWorkspaceSummary = CloudWorkspaceSummary;
