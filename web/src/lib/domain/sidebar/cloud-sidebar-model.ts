import type {
  CloudSessionProjection,
  CloudWorkspaceDetail,
  CloudWorkspaceLastSessionSummary,
  CloudWorkspaceSummary,
} from "@proliferate/cloud-sdk";

export type CloudSidebarWorkspace = CloudWorkspaceSummary | CloudWorkspaceDetail;

export interface CloudSidebarRouteState {
  workspaceId: string | null;
  sessionId: string | null;
  workspacesActive: boolean;
}

export interface CloudSidebarWorkspaceModel {
  id: string;
  label: string;
  subtitle: string | null;
  repoLabel: string;
  branchLabel: string;
  active: boolean;
  archived: boolean;
  statusKind: "ready" | "working" | "blocked" | "archived";
  statusLabel: string;
  visibilityLabel: string;
  exposureLabel: string | null;
  runtimeLabel: string | null;
  trailingLabel: string | null;
  lastSessionId: string | null;
}

export interface CloudSidebarWorkspaceGroupModel {
  id: string;
  label: string;
  sourceKind: CloudSidebarWorkspaceSourceKind;
  count: number;
  collapsed: boolean;
  workspaces: CloudSidebarWorkspaceModel[];
}

export type CloudSidebarWorkspaceSourceKind =
  | "chat"
  | "slack"
  | "automation"
  | "api"
  | "agent";

export interface CloudSidebarSessionModel {
  id: string;
  workspaceId: string;
  label: string;
  subtitle: string | null;
  active: boolean;
  statusLabel: string;
  sourceAgentKind: string | null;
  lastEventAt: string | null;
}

export function parseCloudSidebarRoute(pathname: string): CloudSidebarRouteState {
  const normalizedPath = pathname.replace(/\/+$/u, "") || "/";
  const match = normalizedPath.match(/^\/(?:cloud\/)?workspaces\/([^/]+)(?:\/chats\/([^/]+))?/u);

  return {
    workspaceId: match?.[1] ? decodeRoutePart(match[1]) : null,
    sessionId: match?.[2] ? decodeRoutePart(match[2]) : null,
    workspacesActive:
      normalizedPath === "/workspaces" ||
      normalizedPath.startsWith("/workspaces/") ||
      normalizedPath.startsWith("/cloud/workspaces/"),
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

export function buildCloudSidebarWorkspaceGroups(input: {
  workspaces: readonly CloudSidebarWorkspace[];
  route: CloudSidebarRouteState;
  collapsedGroupIds: ReadonlySet<string>;
}): CloudSidebarWorkspaceGroupModel[] {
  const groups = new Map<string, CloudSidebarWorkspace[]>();
  for (const workspace of sortedWorkspaces(input.workspaces)) {
    const groupId = workspaceSourceGroup(workspace);
    const group = groups.get(groupId);
    if (group) {
      group.push(workspace);
    } else {
      groups.set(groupId, [workspace]);
    }
  }

  return Array.from(groups.entries()).map(([groupId, groupWorkspaces]) => ({
    id: groupId,
    label: groupId,
    sourceKind: workspaceSourceKindFromLabel(groupId),
    count: groupWorkspaces.length,
    collapsed: input.collapsedGroupIds.has(groupId),
    workspaces: groupWorkspaces.map((workspace) =>
      buildCloudSidebarWorkspaceModel(workspace, input.route),
    ),
  }));
}

export function buildCloudSidebarSessionModels(input: {
  workspaces: readonly CloudSidebarWorkspace[];
  activeWorkspaceSessions: readonly CloudSessionProjection[];
  route: CloudSidebarRouteState;
  limit?: number;
}): CloudSidebarSessionModel[] {
  const sessions = new Map<string, CloudSidebarSessionModel>();
  const workspaceById = new Map(input.workspaces.map((workspace) => [workspace.id, workspace]));

  for (const workspace of input.workspaces) {
    const summary = workspace.lastSessionSummary;
    if (!summary?.sessionId) {
      continue;
    }
    sessions.set(summary.sessionId, sessionModelFromLastSummary({
      summary,
      workspace,
      route: input.route,
    }));
  }

  for (const session of input.activeWorkspaceSessions) {
    const workspace = workspaceById.get(session.cloudWorkspaceId ?? "") ??
      (input.route.workspaceId ? workspaceById.get(input.route.workspaceId) : undefined);
    if (!workspace) {
      continue;
    }
    sessions.set(session.sessionId, sessionModelFromProjection({
      session,
      workspace,
      route: input.route,
    }));
  }

  return Array.from(sessions.values())
    .sort(compareSessionModels)
    .slice(0, input.limit ?? 16);
}

export function sortedWorkspaces(
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

export function repoLabel(workspace: CloudSidebarWorkspace): string {
  return `${workspace.repo.owner}/${workspace.repo.name}`;
}

export function workspaceSourceGroup(workspace: CloudSidebarWorkspace): string {
  const creatorKind = workspace.creatorContext?.kind ?? null;
  if (creatorKind === "automation") {
    return "Automations";
  }
  if (creatorKind === "agent") {
    return "Agents";
  }
  const entrypoint = workspace.origin?.entrypoint ?? null;
  if (entrypoint === "slack") {
    return "Slack";
  }
  if (entrypoint === "api") {
    return "API";
  }
  return "Chat";
}

function workspaceSourceKindFromLabel(label: string): CloudSidebarWorkspaceSourceKind {
  switch (label) {
    case "Automations":
      return "automation";
    case "Slack":
      return "slack";
    case "API":
      return "api";
    case "Agents":
      return "agent";
    case "Chat":
    default:
      return "chat";
  }
}

export function workspaceBranchLabel(workspace: CloudSidebarWorkspace): string {
  return workspace.repo.branch ?? workspace.repo.baseBranch ?? "main";
}

export function workspaceDisplayLabel(workspace: CloudSidebarWorkspace): string {
  return workspace.displayName ?? workspaceBranchLabel(workspace) ?? workspace.repo.name;
}

function buildCloudSidebarWorkspaceModel(
  workspace: CloudSidebarWorkspace,
  route: CloudSidebarRouteState,
): CloudSidebarWorkspaceModel {
  const statusLabel = workspaceStatusLabel(workspace.status);
  const visibilityLabel = workspaceVisibilityLabel(workspace);
  const exposureLabel = workspaceExposureLabel(workspace.exposureState ?? null);
  const runtimeLabel = workspaceRuntimeLabel(workspace.runtime?.status ?? null);
  const branchLabel = workspaceBranchLabel(workspace);
  const subtitle = [
    branchLabel,
    statusLabel,
    visibilityLabel,
  ].filter(Boolean).join(" - ");

  return {
    id: workspace.id,
    label: workspaceDisplayLabel(workspace),
    subtitle,
    repoLabel: repoLabel(workspace),
    branchLabel,
    active: route.workspaceId === workspace.id,
    archived: workspace.status === "archived" || workspace.visibility === "archived",
    statusKind: workspaceStatusKind(workspace),
    statusLabel,
    visibilityLabel,
    exposureLabel,
    runtimeLabel,
    trailingLabel: workspaceTrailingLabel(workspace),
    lastSessionId: workspace.lastSessionSummary?.sessionId ?? null,
  };
}

function sessionModelFromLastSummary(input: {
  summary: CloudWorkspaceLastSessionSummary;
  workspace: CloudSidebarWorkspace;
  route: CloudSidebarRouteState;
}): CloudSidebarSessionModel {
  return {
    id: input.summary.sessionId,
    workspaceId: input.workspace.id,
    label: input.summary.title ?? workspaceDisplayLabel(input.workspace),
    subtitle: sessionSubtitle(input.workspace, input.summary.preview ?? null),
    active: isSessionActive(input.route, input.workspace.id, input.summary.sessionId),
    statusLabel: sessionStatusLabel(input.summary.status),
    sourceAgentKind: null,
    lastEventAt: input.summary.lastEventAt ?? null,
  };
}

function sessionModelFromProjection(input: {
  session: CloudSessionProjection;
  workspace: CloudSidebarWorkspace;
  route: CloudSidebarRouteState;
}): CloudSidebarSessionModel {
  return {
    id: input.session.sessionId,
    workspaceId: input.workspace.id,
    label: input.session.title ?? workspaceDisplayLabel(input.workspace),
    subtitle: sessionSubtitle(input.workspace, null),
    active: isSessionActive(input.route, input.workspace.id, input.session.sessionId),
    statusLabel: sessionStatusLabel(input.session.status),
    sourceAgentKind: input.session.sourceAgentKind ?? null,
    lastEventAt: input.session.lastEventAt ?? input.session.startedAt ?? null,
  };
}

function isSessionActive(
  route: CloudSidebarRouteState,
  workspaceId: string,
  sessionId: string,
): boolean {
  return route.workspaceId === workspaceId && route.sessionId === sessionId;
}

function sessionSubtitle(workspace: CloudSidebarWorkspace, preview: string | null): string {
  const base = `${repoLabel(workspace)} - ${workspaceBranchLabel(workspace)}`;
  return preview ? `${base} - ${preview}` : base;
}

function compareSessionModels(left: CloudSidebarSessionModel, right: CloudSidebarSessionModel): number {
  const leftTime = dateSortValue(left.lastEventAt);
  const rightTime = dateSortValue(right.lastEventAt);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return left.label.localeCompare(right.label);
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

function workspaceStatusKind(
  workspace: CloudSidebarWorkspace,
): CloudSidebarWorkspaceModel["statusKind"] {
  if (workspace.status === "archived" || workspace.exposureState === "revoked") {
    return "archived";
  }
  if (workspace.status === "error" || workspace.exposureState === "stale") {
    return "blocked";
  }
  if (workspace.status === "ready") {
    return "ready";
  }
  return "working";
}

function workspaceStatusLabel(status: CloudSidebarWorkspace["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "pending":
      return "Pending";
    case "materializing":
      return "Starting";
    case "needs_rematerialization":
      return "Needs refresh";
    case "archived":
      return "Archived";
    case "error":
    default:
      return "Error";
  }
}

function workspaceRuntimeLabel(
  status: string | null | undefined,
): string | null {
  switch (status) {
    case "running":
      return "Runtime running";
    case "provisioning":
      return "Runtime starting";
    case "paused":
      return "Runtime paused";
    case "error":
      return "Runtime error";
    case "disabled":
      return "Runtime disabled";
    case "pending":
      return "Runtime pending";
    case null:
    case undefined:
      return null;
    default:
      return "Runtime";
  }
}

function workspaceVisibilityLabel(workspace: CloudSidebarWorkspace): string {
  if (workspace.visibility === "shared_unclaimed") {
    return "Unclaimed";
  }
  if (workspace.visibility === "claimed") {
    return "Claimed";
  }
  if (workspace.visibility === "archived") {
    return "Archived";
  }
  if (workspace.sandboxType === "managed_shared") {
    return "Shared";
  }
  if (workspace.sandboxType === "ssh") {
    return "SSH";
  }
  if (workspace.sandboxType === "self_hosted") {
    return "Self-hosted";
  }
  return "Personal";
}

function workspaceExposureLabel(
  exposureState: CloudSidebarWorkspace["exposureState"] | null,
): string | null {
  switch (exposureState) {
    case "live":
      return "Live";
    case "tracked":
      return "Tracked";
    case "paused":
      return "Paused";
    case "stale":
      return "Stale";
    case "revoked":
      return "Revoked";
    case "untracked":
    case null:
    case undefined:
      return null;
  }
}

function workspaceTrailingLabel(workspace: CloudSidebarWorkspace): string | null {
  if (workspace.exposureState === "live") {
    return "Live";
  }
  if (workspace.visibility === "shared_unclaimed") {
    return "Claim";
  }
  if (workspace.visibility === "claimed") {
    return "Claimed";
  }
  return workspaceExposureLabel(workspace.exposureState ?? null);
}

function sessionStatusLabel(status: string): string {
  return status
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Session";
}

function decodeRoutePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
