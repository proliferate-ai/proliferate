import type {
  CloudWorkspaceDetail,
  CloudWorkspaceSummary,
} from "@proliferate/cloud-sdk";

export type CloudSidebarWorkspace = CloudWorkspaceSummary | CloudWorkspaceDetail;

export interface CloudSidebarRouteState {
  workspaceId: string | null;
  sessionId: string | null;
}

export function parseCloudSidebarRoute(pathname: string): CloudSidebarRouteState {
  const normalizedPath = pathname.replace(/\/+$/u, "") || "/";
  const match = normalizedPath.match(/^\/(?:cloud\/)?workspaces\/([^/]+)(?:\/chats\/([^/]+))?/u);

  return {
    workspaceId: match?.[1] ? decodeRoutePart(match[1]) : null,
    sessionId: match?.[2] ? decodeRoutePart(match[2]) : null,
  };
}

export function mergeCloudSidebarWorkspaces(
  workspaces: readonly CloudWorkspaceSummary[],
  activeWorkspace: CloudWorkspaceDetail | null | undefined,
): CloudSidebarWorkspace[] {
  const byId = new Map<string, CloudSidebarWorkspace>();
  for (const workspace of workspaces) {
    byId.set(workspace.id, workspace);
  }
  if (activeWorkspace) {
    byId.set(activeWorkspace.id, activeWorkspace);
  }
  return sortedWorkspaces(Array.from(byId.values()));
}

function sortedWorkspaces(
  workspaces: readonly CloudSidebarWorkspace[],
): CloudSidebarWorkspace[] {
  return [...workspaces].sort((left, right) => {
    const leftTime = workspaceSortTime(left);
    const rightTime = workspaceSortTime(right);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return workspaceDisplayLabel(left).localeCompare(workspaceDisplayLabel(right));
  });
}

function workspaceBranchLabel(workspace: CloudSidebarWorkspace): string {
  return workspace.repo.branch ?? workspace.repo.baseBranch ?? "main";
}

function workspaceDisplayLabel(workspace: CloudSidebarWorkspace): string {
  return workspace.displayName ?? workspaceBranchLabel(workspace) ?? workspace.repo.name;
}

function workspaceSortTime(workspace: CloudSidebarWorkspace): number {
  return dateSortValue(
    workspace.lastSessionSummary?.lastEventAt ??
    workspace.lastActivityAt ??
    workspace.updatedAt ??
    workspace.createdAt ??
    null,
  );
}

function dateSortValue(value: string | null | undefined): number {
  return value ? Date.parse(value) || 0 : 0;
}

function decodeRoutePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
