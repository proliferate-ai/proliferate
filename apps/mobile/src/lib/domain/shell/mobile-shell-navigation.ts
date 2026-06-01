import type {
  AuthUser,
  CloudSessionProjection,
  CloudWorkspaceDetail,
} from "@proliferate/cloud-sdk";

import {
  allWorkRoute,
  drawerRoutes,
  type MobileCloudChat,
  type RouteId,
} from "../../../navigation/navigation-model";

export const MOBILE_SHELL_ROUTE_STORAGE_KEY = "proliferate.mobile.shell.route";
export const MOBILE_SHELL_CHAT_STORAGE_KEY = "proliferate.mobile.shell.chat";
export const MOBILE_SHELL_STORAGE_VERSION = 1;

export interface MobileShellAccountSummary {
  initials: string;
  name: string;
  handle: string;
}

export interface StoredMobileShellRoute {
  version: number;
  ownerUserId: string;
  route: RouteId;
  updatedAt: number;
}

export interface StoredMobileShellChat {
  version: number;
  ownerUserId: string;
  chat: MobileCloudChat;
  updatedAt: number;
}

export function buildMobileShellAccountSummary(user: AuthUser | null): MobileShellAccountSummary {
  const displayName = user?.display_name?.trim();
  const email = user?.email?.trim();
  const fallbackName = email?.split("@")[0] || "Proliferate";
  const name = displayName || fallbackName;
  return {
    initials: initialsForName(name),
    name,
    handle: email || "Signed in",
  };
}

export function mobileShellRouteSubtitle(route: RouteId): string | undefined {
  switch (route) {
    case "home":
      return "New chat";
    case "work":
      return "Workspaces";
    case "automations":
      return "Scheduled runs";
    case "settings":
      return "Account · device";
  }
}

export function mobileWorkspaceLinkFromUrl(
  url: string | null,
): { workspaceId: string; sessionId: string | null } | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const rawParts = parsed.pathname.split("/").filter(Boolean);
    const parts = parsed.protocol === "proliferate:"
      ? [parsed.hostname, ...rawParts]
      : rawParts;
    const workspaceIndex =
      parts[0] === "cloud" && parts[1] === "workspaces"
        ? 1
        : parts[0] === "workspaces"
          ? 0
          : -1;
    const workspaceId = workspaceIndex >= 0 ? parts[workspaceIndex + 1] : null;
    if (!workspaceId) {
      return null;
    }
    const sessionPathKind = parts[workspaceIndex + 2];
    const sessionId =
      sessionPathKind === "chats" || sessionPathKind === "sessions"
        ? parts[workspaceIndex + 3] ?? null
        : parsed.searchParams.get("sessionId");
    return {
      workspaceId: decodeURIComponent(workspaceId),
      sessionId: sessionId ? decodeURIComponent(sessionId) : null,
    };
  } catch {
    return null;
  }
}

export function mobileLinkedChatForWorkspace(
  workspace: CloudWorkspaceDetail,
  sessions: readonly CloudSessionProjection[],
  linkedSessionId: string | null,
): MobileCloudChat | null {
  const sortedSessions = [...sessions].sort(compareSessions);
  const session = linkedSessionId
    ? sortedSessions.find((candidate) => candidate.sessionId === linkedSessionId) ?? sortedSessions[0] ?? null
    : sortedSessions[0] ?? null;
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.displayName ?? workspace.repo.name,
    repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
    branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
    targetId: session?.targetId ?? workspace.targetId ?? null,
    workspaceRuntimeId: session?.workspaceId ?? workspace.anyharnessWorkspaceId ?? null,
    sessionId: session?.sessionId ?? null,
    title: session?.title ?? workspace.displayName ?? workspace.repo.name,
    status: session?.status ?? workspace.workspaceStatus ?? workspace.status,
    visibility: workspace.visibility,
  };
}

export function parseStoredMobileShellRoute(value: string | null, ownerUserId: string): RouteId | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<StoredMobileShellRoute>;
    if (parsed.version === MOBILE_SHELL_STORAGE_VERSION && parsed.ownerUserId === ownerUserId) {
      return parseStoredRouteId(parsed.route);
    }
  } catch {
    return null;
  }
  return null;
}

export function parseStoredMobileShellChat(
  value: string | null,
  ownerUserId: string,
): MobileCloudChat | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<StoredMobileShellChat>;
    if (parsed.version === MOBILE_SHELL_STORAGE_VERSION && parsed.ownerUserId === ownerUserId) {
      return parseStoredChatValue(parsed.chat);
    }
  } catch {
    return null;
  }
  return null;
}

export function chatForMobileShellPersistence(chat: MobileCloudChat): MobileCloudChat {
  if (!chat.initialPendingPrompt) {
    return chat;
  }
  return {
    ...chat,
    initialPendingPrompt: null,
  };
}

export function mobileShellRouteStorageKey(ownerUserId: string): string {
  return `${MOBILE_SHELL_ROUTE_STORAGE_KEY}.${encodeURIComponent(ownerUserId)}`;
}

export function mobileShellChatStorageKey(ownerUserId: string): string {
  return `${MOBILE_SHELL_CHAT_STORAGE_KEY}.${encodeURIComponent(ownerUserId)}`;
}

function initialsForName(name: string): string {
  const parts = name
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) || "P").toUpperCase();
}

function parseStoredRouteId(value: unknown): RouteId | null {
  if (value === "workspaces" || value === "sessions") {
    return "work";
  }
  if (typeof value === "string") {
    if (value === allWorkRoute.id || drawerRoutes.some((route) => route.id === value)) {
      return value as RouteId;
    }
  }
  return null;
}

function parseStoredChatValue(value: unknown): MobileCloudChat | null {
  const parsed = value as Partial<MobileCloudChat>;
  if (
    typeof parsed.workspaceId === "string"
    && typeof parsed.workspaceName === "string"
    && typeof parsed.repoLabel === "string"
    && typeof parsed.branchLabel === "string"
    && (typeof parsed.targetId === "string" || parsed.targetId === null)
    && (typeof parsed.workspaceRuntimeId === "string" || parsed.workspaceRuntimeId === null)
    && (typeof parsed.sessionId === "string" || parsed.sessionId === null)
    && typeof parsed.title === "string"
    && typeof parsed.status === "string"
    && typeof parsed.visibility === "string"
  ) {
    return {
      workspaceId: parsed.workspaceId,
      workspaceName: parsed.workspaceName,
      repoLabel: parsed.repoLabel,
      branchLabel: parsed.branchLabel,
      targetId: parsed.targetId,
      workspaceRuntimeId: parsed.workspaceRuntimeId,
      sessionId: parsed.sessionId,
      title: parsed.title,
      status: parsed.status,
      visibility: parsed.visibility,
      initialPendingPrompt: null,
    };
  }
  return null;
}

function compareSessions(left: CloudSessionProjection, right: CloudSessionProjection): number {
  return sessionRecencyMs(right) - sessionRecencyMs(left)
    || (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0);
}

function sessionRecencyMs(session: Pick<CloudSessionProjection, "lastEventAt" | "startedAt">): number {
  return Date.parse(session.lastEventAt ?? session.startedAt ?? "") || 0;
}
