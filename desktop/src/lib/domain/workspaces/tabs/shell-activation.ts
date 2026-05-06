import {
  chatWorkspaceShellTabKey,
  parseWorkspaceShellTabKey,
  viewerWorkspaceShellTabKey,
  type WorkspaceShellIntentKey,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import type { ViewerTargetKey } from "@/lib/domain/workspaces/viewer-target";

export interface PendingChatActivation {
  attemptId: string;
  sessionId: string;
  intent: `chat:${string}`;
  guardToken: number;
  workspaceSelectionNonce: number;
  shellEpochAtWrite: number;
  sessionActivationEpochAtWrite: number;
}

export type WorkspaceRenderSurface =
  | { kind: "chat-session"; sessionId: string }
  | { kind: "chat-session-pending"; sessionId: string }
  | { kind: "viewer"; targetKey: ViewerTargetKey }
  | { kind: "chat-shell" };

export interface WorkspaceShellActivationInput {
  workspaceId: string;
  storedIntent: WorkspaceShellIntentKey | null;
  orderedTabs: readonly WorkspaceShellTabKey[];
  activeSessionId: string | null;
  activeViewerTargetKey: ViewerTargetKey | null;
  liveChatSessionIds: ReadonlySet<string>;
  openViewerTargetKeys: ReadonlySet<string>;
  pendingChatActivation: PendingChatActivation | null;
  currentShellActivationEpoch: number;
  currentSessionActivationEpoch: number;
  currentWorkspaceSelectionNonce: number;
}

export interface WorkspaceShellActivation {
  renderSurface: WorkspaceRenderSurface;
  highlightedTabKey: WorkspaceShellTabKey | null;
}

export function resolveWorkspaceShellActivation(
  input: WorkspaceShellActivationInput,
): WorkspaceShellActivation {
  const pendingOverride = resolveCurrentPendingChatActivation(input);
  if (pendingOverride) {
    return pendingOverride;
  }

  if (input.storedIntent === "chat-shell") {
    return chatShellActivation();
  }

  if (input.storedIntent) {
    const parsed = parseWorkspaceShellTabKey(input.storedIntent);
    if (parsed?.kind === "chat") {
      const key = chatWorkspaceShellTabKey(parsed.sessionId);
      if (
        input.activeSessionId === parsed.sessionId
        && input.liveChatSessionIds.has(parsed.sessionId)
        && input.orderedTabs.includes(key)
      ) {
        return {
          renderSurface: { kind: "chat-session", sessionId: parsed.sessionId },
          highlightedTabKey: key,
        };
      }
      return chatShellActivation();
    }

    if (parsed?.kind === "viewer") {
      const key = viewerWorkspaceShellTabKey(parsed.target);
      if (
        input.activeViewerTargetKey === key
        && input.openViewerTargetKeys.has(key)
        && input.orderedTabs.includes(key)
      ) {
        return {
          renderSurface: { kind: "viewer", targetKey: key },
          highlightedTabKey: key,
        };
      }
      return chatShellActivation();
    }

    return chatShellActivation();
  }

  return inferNullIntentActivation(input);
}

export function resolveNextShellTabAfterClose({
  orderedTabs,
  closingTabKeys,
  currentTabKey,
  anchorTabKey,
}: {
  orderedTabs: readonly WorkspaceShellTabKey[];
  closingTabKeys: readonly WorkspaceShellTabKey[];
  currentTabKey: WorkspaceShellTabKey | null;
  anchorTabKey?: WorkspaceShellTabKey | null;
}): WorkspaceShellTabKey | null {
  const orderedSet = new Set(orderedTabs);
  const closingSet = new Set(closingTabKeys.filter((key) => orderedSet.has(key)));
  if (closingSet.size === 0) {
    return currentTabKey && orderedSet.has(currentTabKey) ? currentTabKey : orderedTabs[0] ?? null;
  }

  if (currentTabKey && orderedSet.has(currentTabKey) && !closingSet.has(currentTabKey)) {
    return currentTabKey;
  }

  const removedIndices = orderedTabs
    .map((key, index) => closingSet.has(key) ? index : -1)
    .filter((index) => index >= 0);
  const anchorIndex = anchorTabKey && orderedSet.has(anchorTabKey)
    ? orderedTabs.indexOf(anchorTabKey)
    : Math.max(...removedIndices);
  const afterStart = Math.max(anchorIndex, 0);

  for (let index = afterStart + 1; index < orderedTabs.length; index += 1) {
    const candidate = orderedTabs[index];
    if (candidate && !closingSet.has(candidate)) {
      return candidate;
    }
  }

  for (let index = Math.min(afterStart, orderedTabs.length - 1); index >= 0; index -= 1) {
    const candidate = orderedTabs[index];
    if (candidate && !closingSet.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveCurrentPendingChatActivation(
  input: WorkspaceShellActivationInput,
): WorkspaceShellActivation | null {
  const pending = input.pendingChatActivation;
  if (!pending || !isCurrentPendingChatActivation(input, pending.intent)) {
    return null;
  }
  if (!input.orderedTabs.includes(pending.intent)) {
    return null;
  }
  return {
    renderSurface: { kind: "chat-session-pending", sessionId: pending.sessionId },
    highlightedTabKey: pending.intent,
  };
}

function isCurrentPendingChatActivation(
  input: WorkspaceShellActivationInput,
  key: WorkspaceShellTabKey,
): boolean {
  const pending = input.pendingChatActivation;
  if (!pending) {
    return false;
  }
  return pending.intent === key
    && pending.shellEpochAtWrite === input.currentShellActivationEpoch
    && pending.guardToken === input.currentSessionActivationEpoch
    && pending.workspaceSelectionNonce === input.currentWorkspaceSelectionNonce
    && pending.sessionActivationEpochAtWrite === input.currentSessionActivationEpoch;
}

function inferNullIntentActivation(
  input: WorkspaceShellActivationInput,
): WorkspaceShellActivation {
  const chatKey = input.activeSessionId ? chatWorkspaceShellTabKey(input.activeSessionId) : null;
  const viewerKey = input.activeViewerTargetKey;
  const hasLiveChat = !!input.activeSessionId
    && !!chatKey
    && input.liveChatSessionIds.has(input.activeSessionId)
    && input.orderedTabs.includes(chatKey);
  const hasLiveViewer = !!viewerKey
    && input.openViewerTargetKeys.has(viewerKey)
    && input.orderedTabs.includes(viewerKey);

  if (hasLiveChat && !hasLiveViewer && input.activeSessionId && chatKey) {
    return {
      renderSurface: { kind: "chat-session", sessionId: input.activeSessionId },
      highlightedTabKey: chatKey,
    };
  }

  if (hasLiveViewer && !hasLiveChat && viewerKey) {
    return {
      renderSurface: { kind: "viewer", targetKey: viewerKey },
      highlightedTabKey: viewerKey,
    };
  }

  return chatShellActivation();
}

function chatShellActivation(): WorkspaceShellActivation {
  return {
    renderSurface: { kind: "chat-shell" },
    highlightedTabKey: null,
  };
}
