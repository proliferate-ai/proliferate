import type {
  CloudCommandStatus,
  CloudSessionProjection,
  CloudWorkspaceDetail,
} from "@proliferate/cloud-sdk";
import {
  recentWorkRuntimeLabel,
  recentWorkRuntimeLocationForWorkspace,
  recentWorkSourceForWorkspace,
  recentWorkSourceLabel,
  type RecentWorkRuntimeLocation,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";

export type MobileChatIconName =
  | "brain"
  | "claude"
  | "cloud"
  | "controls"
  | "monitor"
  | "openai"
  | "sessions"
  | "shield"
  | "sparkles"
  | "terminal";

export type MobileStatusValue = "running" | "idle" | "paused" | "failed" | "done";

export type RuntimeContextView = {
  label: string;
  detail: string;
  icon: MobileChatIconName;
  status: MobileStatusValue;
};

type ChatSessionProjectionInput = {
  workspaceId: string;
  targetId: string | null;
  workspaceRuntimeId: string | null;
  sessionId: string | null;
  title: string;
  status: string;
};

export function sessionProjectionFromChat(
  chat: ChatSessionProjectionInput,
): CloudSessionProjection | null {
  if (!chat.sessionId || !chat.targetId) {
    return null;
  }
  return {
    targetId: chat.targetId,
    cloudWorkspaceId: chat.workspaceId,
    workspaceId: chat.workspaceRuntimeId ?? chat.workspaceId,
    sessionId: chat.sessionId,
    nativeSessionId: null,
    sourceAgentKind: null,
    title: chat.title,
    status: chat.status,
    phase: null,
    pendingInteractionCount: 0,
    liveConfig: null,
    lastEventSeq: 0,
    lastEventAt: null,
    startedAt: null,
    endedAt: null,
  };
}

export function compareSessions(
  left: CloudSessionProjection,
  right: CloudSessionProjection,
): number {
  return sessionRecencyMs(right) - sessionRecencyMs(left)
    || (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0);
}

export function sessionDisplayTitle(session: CloudSessionProjection, index: number): string {
  const title = session.title?.trim();
  if (title) {
    return title;
  }
  return `Session ${index + 1}`;
}

export function sessionDisplaySubtitle(session: CloudSessionProjection): string {
  return `${session.status ?? "idle"} · ${shortSessionLabel(session.sessionId)}`;
}

export function shortSessionLabel(sessionId: string | null | undefined): string {
  return sessionId?.slice(0, 8) ?? "pending";
}

export function summarizeRuntimeContext(
  workspace: CloudWorkspaceDetail | null,
  workspaceStatus: string,
): RuntimeContextView {
  if (!workspace) {
    return {
      label: "Runtime",
      detail: "Loading machine",
      icon: "cloud",
      status: "idle",
    };
  }

  const runtimeLocation = recentWorkRuntimeLocationForWorkspace(workspace);
  const runtimeLabel = workspace.executionTarget?.label?.trim()
    || fallbackRuntimeLabel(workspace, runtimeLocation);
  const sourceDetail = runtimeSourceDetail(workspace);
  const statusDetail = runtimeStatusDetail(workspace, workspaceStatus);
  const detail = joinUniqueLabels([sourceDetail, statusDetail]) || "Runtime status unknown";

  return {
    label: runtimeLabel,
    detail,
    icon: runtimeIcon(workspace, runtimeLocation),
    status: runtimeDotStatus(workspace, workspaceStatus),
  };
}

export function joinUniqueLabels(labels: Array<string | null | undefined>): string {
  const normalized = new Set<string>();
  const parts: string[] = [];
  for (const label of labels) {
    const trimmed = label?.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (normalized.has(key)) {
      continue;
    }
    normalized.add(key);
    parts.push(trimmed);
  }
  return parts.join(" · ");
}

export function formatSessionCount(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}

export function effectiveWorkspaceStatus(
  workspace: { status?: string | null; workspaceStatus?: string | null },
): string {
  return workspace.workspaceStatus ?? workspace.status ?? "unknown";
}

export function mobileStatus(status: string | null | undefined): MobileStatusValue {
  if (status === "running") {
    return "running";
  }
  if (status === "failed" || status === "error") {
    return "failed";
  }
  if (status === "paused") {
    return "paused";
  }
  if (status === "ended" || status === "done" || status === "completed") {
    return "done";
  }
  return "idle";
}

export function isRejectedCommandStatus(status: CloudCommandStatus): boolean {
  return status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

export function isTerminalCommandStatus(status: CloudCommandStatus): boolean {
  return status === "accepted"
    || status === "accepted_but_queued"
    || isRejectedCommandStatus(status);
}

export function sessionConfigCommandFailureMessage(status: CloudCommandStatus): string {
  switch (status) {
    case "expired":
      return "Session configuration update expired before it was applied.";
    case "superseded":
      return "Session configuration update was superseded.";
    case "failed_delivery":
      return "Session configuration update could not be delivered.";
    case "rejected":
    default:
      return "Session configuration update was rejected.";
  }
}

export function promptCommandFailureMessage(status: CloudCommandStatus): string {
  switch (status) {
    case "expired":
      return "Prompt expired before it was delivered.";
    case "superseded":
      return "Prompt was superseded before it was delivered.";
    case "failed_delivery":
      return "Prompt could not be delivered.";
    case "rejected":
    default:
      return "Prompt was rejected.";
  }
}

export function resolveAgentKind(workspace: CloudWorkspaceDetail): string {
  if (workspace.readyAgentKinds?.includes("codex")) {
    return "codex";
  }
  return workspace.readyAgentKinds?.[0] ?? workspace.allowedAgentKinds?.[0] ?? "codex";
}

function sessionRecencyMs(
  session: Pick<CloudSessionProjection, "lastEventAt" | "startedAt">,
): number {
  return Date.parse(session.lastEventAt ?? session.startedAt ?? "") || 0;
}

function fallbackRuntimeLabel(
  workspace: CloudWorkspaceDetail,
  runtimeLocation: RecentWorkRuntimeLocation,
): string {
  switch (workspace.executionTarget?.kind) {
    case "managed_cloud":
      return "Cloud runtime";
    case "local_desktop":
      return "Desktop dispatch";
    case "ssh":
      return "SSH remote";
    case "self_hosted":
      return "Self-hosted runner";
    default:
      return recentWorkRuntimeLabel(runtimeLocation);
  }
}

function runtimeSourceDetail(workspace: CloudWorkspaceDetail): string | null {
  const sourceKind = recentWorkSourceForWorkspace(workspace);
  if (sourceKind === "cloud_sandbox" || sourceKind === "unknown") {
    return null;
  }
  if (sourceKind === "mobile") {
    return "Mobile dispatch";
  }
  if (sourceKind === "desktop_exposed") {
    return "Desktop dispatch";
  }
  if (sourceKind === "web") {
    return "Web dispatch";
  }
  return recentWorkSourceLabel(sourceKind);
}

function runtimeStatusDetail(workspace: CloudWorkspaceDetail, workspaceStatus: string): string {
  switch (workspace.runtime?.status) {
    case "running":
      return "Running";
    case "provisioning":
    case "pending":
      return "Starting";
    case "paused":
      return "Paused";
    case "error":
      return "Error";
    case "disabled":
      return "Disabled";
    case undefined:
      break;
  }
  if (workspace.executionTarget?.online === true) {
    return "Online";
  }
  if (workspace.executionTarget?.online === false) {
    return "Offline";
  }
  switch (workspaceStatus) {
    case "ready":
      return "Ready";
    case "materializing":
    case "needs_rematerialization":
      return "Setting up";
    case "pending":
      return "Pending";
    case "error":
      return "Error";
    default:
      return "Status unknown";
  }
}

function runtimeIcon(
  workspace: CloudWorkspaceDetail,
  runtimeLocation: RecentWorkRuntimeLocation,
): MobileChatIconName {
  switch (workspace.executionTarget?.kind) {
    case "managed_cloud":
      return "cloud";
    case "local_desktop":
      return "monitor";
    case "ssh":
    case "self_hosted":
      return "terminal";
    case undefined:
      break;
  }
  switch (runtimeLocation) {
    case "local_desktop":
      return "monitor";
    case "cloud_sandbox":
      return "cloud";
    case "ssh_remote":
      return "terminal";
    case "offline":
      return workspace.sandboxType === "local" ? "monitor" : "cloud";
    case "unknown":
      return "cloud";
  }
}

function runtimeDotStatus(
  workspace: CloudWorkspaceDetail,
  workspaceStatus: string,
): RuntimeContextView["status"] {
  if (workspace.runtime?.status === "provisioning" || workspace.runtime?.status === "pending") {
    return "running";
  }
  if (workspace.runtime?.status) {
    return mobileStatus(workspace.runtime.status);
  }
  if (workspace.executionTarget?.online === true) {
    return "running";
  }
  if (workspace.executionTarget?.online === false) {
    return "paused";
  }
  return mobileStatus(workspaceStatus);
}
