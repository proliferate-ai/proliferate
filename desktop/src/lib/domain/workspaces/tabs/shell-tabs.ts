import { sessionSlotBelongsToWorkspace } from "@/lib/domain/sessions/activity";
import {
  fileViewerTarget,
  parseViewerTargetKey,
  viewerTargetKey,
  type ViewerTarget,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer-target";

export type WorkspaceShellTab =
  | { kind: "chat"; sessionId: string }
  | { kind: "viewer"; target: ViewerTarget };

export type WorkspaceShellTabKey = string;
export type ChatWorkspaceShellTabKey = `chat:${string}`;
export type ViewerWorkspaceShellTabKey = ViewerTargetKey;
export type WorkspaceShellIntentKey = WorkspaceShellTabKey | "chat-shell";

const CHAT_TAB_KEY_PREFIX = "chat:";
const FILE_TAB_KEY_PREFIX = "file:";

export interface WorkspaceSessionTabCandidate {
  sessionId: string;
  workspaceId: string | null;
}

export function chatWorkspaceShellTabKey(sessionId: string): ChatWorkspaceShellTabKey {
  return `${CHAT_TAB_KEY_PREFIX}${sessionId}`;
}

export function fileWorkspaceShellTabKey(path: string): WorkspaceShellTabKey {
  return viewerTargetKey(fileViewerTarget(path));
}

export function viewerWorkspaceShellTabKey(target: ViewerTarget): ViewerWorkspaceShellTabKey {
  return viewerTargetKey(target);
}

export function chatShellWorkspaceIntentKey(): WorkspaceShellIntentKey {
  return "chat-shell";
}

export function getWorkspaceShellTabKey(tab: WorkspaceShellTab): WorkspaceShellTabKey {
  return tab.kind === "chat"
    ? chatWorkspaceShellTabKey(tab.sessionId)
    : viewerWorkspaceShellTabKey(tab.target);
}

export function parseWorkspaceShellTabKey(key: string): WorkspaceShellTab | null {
  if (key.startsWith(CHAT_TAB_KEY_PREFIX)) {
    const sessionId = key.slice(CHAT_TAB_KEY_PREFIX.length);
    return sessionId ? { kind: "chat", sessionId } : null;
  }

  const viewerTarget = parseViewerTargetKey(key);
  if (viewerTarget) {
    return { kind: "viewer", target: viewerTarget };
  }

  if (key.startsWith(FILE_TAB_KEY_PREFIX)) {
    const path = key.slice(FILE_TAB_KEY_PREFIX.length);
    return path ? { kind: "viewer", target: fileViewerTarget(path) } : null;
  }

  return null;
}

export function partitionWorkspaceShellTabKeys(
  keys: readonly WorkspaceShellTabKey[],
): {
  chatSessionIds: string[];
  viewerTargetKeys: ViewerTargetKey[];
} {
  const chatSessionIds: string[] = [];
  const viewerTargetKeys: ViewerTargetKey[] = [];

  for (const key of keys) {
    const tab = parseWorkspaceShellTabKey(key);
    if (tab?.kind === "chat") {
      chatSessionIds.push(tab.sessionId);
    } else if (tab?.kind === "viewer") {
      viewerTargetKeys.push(viewerTargetKey(tab.target));
    }
  }

  return { chatSessionIds, viewerTargetKeys };
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

  if (left.kind === "viewer" && right.kind === "viewer") {
    return viewerTargetKey(left.target) === viewerTargetKey(right.target);
  }

  return false;
}

export function buildWorkspaceShellTabs(args: {
  selectedWorkspaceId: string | null;
  sessionSlots: Record<string, WorkspaceSessionTabCandidate>;
  visibleChatSessionIds?: string[];
  openTargets: ViewerTarget[];
  orderKeys?: readonly WorkspaceShellTabKey[];
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

  const viewerTabs = args.openTargets.map<WorkspaceShellTab>((target) => ({
    kind: "viewer",
    target,
  }));

  return orderWorkspaceShellTabs({
    tabs: [...chatTabs, ...viewerTabs],
    orderKeys: args.orderKeys,
  });
}

export function resolveWorkspaceShellTabFromKey(
  key: WorkspaceShellTabKey | null | undefined,
  tabs: readonly WorkspaceShellTab[],
): WorkspaceShellTab | null {
  if (!key) {
    return null;
  }
  const parsed = parseWorkspaceShellTabKey(key);
  if (!parsed) {
    return null;
  }
  return tabs.find((tab) => isSameWorkspaceShellTab(tab, parsed)) ?? null;
}

export function orderWorkspaceShellTabs(args: {
  tabs: readonly WorkspaceShellTab[];
  orderKeys?: readonly WorkspaceShellTabKey[];
}): WorkspaceShellTab[] {
  if (!args.orderKeys || args.orderKeys.length === 0) {
    return [...args.tabs];
  }

  const tabByKey = new Map(args.tabs.map((tab) => [getWorkspaceShellTabKey(tab), tab]));
  const ordered: WorkspaceShellTab[] = [];
  const seen = new Set<WorkspaceShellTabKey>();

  for (const rawKey of args.orderKeys) {
    const parsed = parseWorkspaceShellTabKey(rawKey);
    const key = parsed ? getWorkspaceShellTabKey(parsed) : rawKey;
    const tab = tabByKey.get(key);
    if (!tab || seen.has(key)) {
      continue;
    }
    ordered.push(tab);
    seen.add(key);
  }

  for (const tab of args.tabs) {
    const key = getWorkspaceShellTabKey(tab);
    if (!seen.has(key)) {
      ordered.push(tab);
      seen.add(key);
    }
  }

  return ordered;
}

export function sanitizeWorkspaceShellTabOrder(args: {
  orderKeys: readonly WorkspaceShellTabKey[];
  liveTabs: readonly WorkspaceShellTab[];
}): WorkspaceShellTabKey[] {
  return orderWorkspaceShellTabs({
    tabs: args.liveTabs,
    orderKeys: args.orderKeys,
  }).map(getWorkspaceShellTabKey);
}

export function resolveFallbackWorkspaceShellTab(args: {
  tabs: readonly WorkspaceShellTab[];
  closingTabs: readonly WorkspaceShellTab[];
  activeTab: WorkspaceShellTab | null;
  anchorTab?: WorkspaceShellTab | null;
}): WorkspaceShellTab | null {
  const closingKeys = new Set(args.closingTabs.map(getWorkspaceShellTabKey));
  if (args.activeTab && !closingKeys.has(getWorkspaceShellTabKey(args.activeTab))) {
    return args.activeTab;
  }

  const remaining = args.tabs.filter((tab) => !closingKeys.has(getWorkspaceShellTabKey(tab)));
  if (remaining.length === 0) {
    return null;
  }

  const anchor = args.anchorTab ?? args.activeTab;
  if (!anchor) {
    return remaining[0] ?? null;
  }

  const anchorIndex = args.tabs.findIndex((tab) => isSameWorkspaceShellTab(tab, anchor));
  if (anchorIndex < 0) {
    return remaining[0] ?? null;
  }

  for (let index = anchorIndex; index >= 0; index -= 1) {
    const candidate = args.tabs[index];
    if (candidate && !closingKeys.has(getWorkspaceShellTabKey(candidate))) {
      return candidate;
    }
  }

  return remaining[0] ?? null;
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
    return delta < 0
      ? tabs[tabs.length - 1] ?? null
      : tabs[0] ?? null;
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
