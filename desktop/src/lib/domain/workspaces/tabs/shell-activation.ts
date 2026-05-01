import {
  chatWorkspaceShellTabKey,
  fileWorkspaceShellTabKey,
  parseWorkspaceShellTabKey,
  type WorkspaceShellIntentKey,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";

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
  | { kind: "file"; path: string }
  | { kind: "chat-shell" };

export interface WorkspaceShellActivationInput {
  workspaceId: string;
  storedIntent: WorkspaceShellIntentKey | null;
  orderedTabs: readonly WorkspaceShellTabKey[];
  activeSessionId: string | null;
  activeFilePath: string | null;
  liveChatSessionIds: ReadonlySet<string>;
  openFilePaths: ReadonlySet<string>;
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
  if (input.storedIntent === "chat-shell") {
    return chatShellActivation();
  }

  if (input.storedIntent) {
    const parsed = parseWorkspaceShellTabKey(input.storedIntent);
    if (parsed?.kind === "chat") {
      const key = chatWorkspaceShellTabKey(parsed.sessionId);
      if (isCurrentPendingChatActivation(input, key)) {
        return {
          renderSurface: { kind: "chat-session-pending", sessionId: parsed.sessionId },
          highlightedTabKey: key,
        };
      }
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

    if (parsed?.kind === "file") {
      const key = fileWorkspaceShellTabKey(parsed.path);
      if (
        input.activeFilePath === parsed.path
        && input.openFilePaths.has(parsed.path)
        && input.orderedTabs.includes(key)
      ) {
        return {
          renderSurface: { kind: "file", path: parsed.path },
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
  const fileKey = input.activeFilePath ? fileWorkspaceShellTabKey(input.activeFilePath) : null;
  const hasLiveChat = !!input.activeSessionId
    && !!chatKey
    && input.liveChatSessionIds.has(input.activeSessionId)
    && input.orderedTabs.includes(chatKey);
  const hasLiveFile = !!input.activeFilePath
    && !!fileKey
    && input.openFilePaths.has(input.activeFilePath)
    && input.orderedTabs.includes(fileKey);

  if (hasLiveChat && !hasLiveFile && input.activeSessionId && chatKey) {
    return {
      renderSurface: { kind: "chat-session", sessionId: input.activeSessionId },
      highlightedTabKey: chatKey,
    };
  }

  if (hasLiveFile && !hasLiveChat && input.activeFilePath && fileKey) {
    return {
      renderSurface: { kind: "file", path: input.activeFilePath },
      highlightedTabKey: fileKey,
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
