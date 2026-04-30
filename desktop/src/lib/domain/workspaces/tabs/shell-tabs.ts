import { sessionSlotBelongsToWorkspace } from "@/lib/domain/sessions/activity";

export type WorkspaceShellTab =
  | { kind: "chat"; sessionId: string }
  | { kind: "file"; path: string };

export interface WorkspaceSessionTabCandidate {
  sessionId: string;
  workspaceId: string | null;
}

export interface MainTabState {
  kind: "chat";
}

export interface FileMainTabState {
  kind: "file";
  path: string;
}

export function isSameWorkspaceShellTab(
  left: WorkspaceShellTab,
  right: WorkspaceShellTab,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "chat" && right.kind === "chat") {
    return left.sessionId === right.sessionId;
  }

  if (left.kind === "file" && right.kind === "file") {
    return left.path === right.path;
  }

  return false;
}

export function buildWorkspaceShellTabs(args: {
  selectedWorkspaceId: string | null;
  sessionSlots: Record<string, WorkspaceSessionTabCandidate>;
  visibleChatSessionIds?: string[];
  openTabs: string[];
}): WorkspaceShellTab[] {
  const visibleSet = args.visibleChatSessionIds
    ? new Set(args.visibleChatSessionIds)
    : null;
  const liveChatTabs: Array<WorkspaceShellTab & { kind: "chat" }> = Object.values(args.sessionSlots)
    .filter((slot) =>
      sessionSlotBelongsToWorkspace(slot, args.selectedWorkspaceId)
      && (!visibleSet || visibleSet.has(slot.sessionId))
    )
    .map((slot) => ({
      kind: "chat",
      sessionId: slot.sessionId,
    }));

  const chatById = new Map(liveChatTabs.map((tab) => [tab.sessionId, tab]));
  const chatTabs = args.visibleChatSessionIds
    ? args.visibleChatSessionIds
      .map((sessionId) => chatById.get(sessionId))
      .filter((tab): tab is WorkspaceShellTab & { kind: "chat" } => !!tab)
    : liveChatTabs;

  const fileTabs = args.openTabs.map<WorkspaceShellTab>((path) => ({
    kind: "file",
    path,
  }));

  return [...chatTabs, ...fileTabs];
}

export function resolveActiveWorkspaceShellTab(args: {
  activeMainTab: MainTabState | FileMainTabState;
  activeSessionId: string | null;
}): WorkspaceShellTab | null {
  if (args.activeMainTab.kind === "file") {
    return {
      kind: "file",
      path: args.activeMainTab.path,
    };
  }

  if (!args.activeSessionId) {
    return null;
  }

  return {
    kind: "chat",
    sessionId: args.activeSessionId,
  };
}

export function resolveRelativeWorkspaceShellTab(args: {
  tabs: WorkspaceShellTab[];
  activeTab: WorkspaceShellTab | null;
  delta: number;
}): WorkspaceShellTab | null {
  const { tabs, activeTab, delta } = args;
  if (tabs.length === 0) {
    return null;
  }

  if (!activeTab) {
    return tabs[0] ?? null;
  }

  const activeIndex = tabs.findIndex((tab) => isSameWorkspaceShellTab(tab, activeTab));
  if (activeIndex === -1) {
    return tabs[0] ?? null;
  }

  const nextIndex = (activeIndex + delta + tabs.length) % tabs.length;
  return tabs[nextIndex] ?? null;
}

export function resolveWorkspaceShellTabByShortcutIndex(
  tabs: WorkspaceShellTab[],
  key: string,
): WorkspaceShellTab | null {
  if (!/^[1-9]$/.test(key)) {
    return null;
  }

  const requestedIndex = Number.parseInt(key, 10);
  if (requestedIndex === 9) {
    return tabs[tabs.length - 1] ?? null;
  }

  return tabs[requestedIndex - 1] ?? null;
}
