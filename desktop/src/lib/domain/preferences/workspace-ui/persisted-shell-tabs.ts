import { sanitizeWorkspaceShellTabKeys } from "@/lib/domain/workspaces/tabs/shell-file-seed";
import {
  parseWorkspaceShellTabKey,
  type WorkspaceShellIntentKey,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import { isTransientClientSessionId } from "@/lib/domain/preferences/workspace-ui/persisted-chat-sessions";

export function sanitizeActiveShellTabKeysByWorkspace(
  value: unknown,
): Record<string, WorkspaceShellIntentKey | null> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const next: Record<string, WorkspaceShellIntentKey | null> = {};
  for (const [workspaceId, key] of Object.entries(value)) {
    if (key === null) {
      next[workspaceId] = null;
      continue;
    }
    if (key === "chat-shell") {
      next[workspaceId] = key;
      continue;
    }
    if (
      typeof key === "string"
      && sanitizeWorkspaceShellTabKeys([key]).length === 1
      && !isTransientChatTabKey(key)
    ) {
      next[workspaceId] = key;
    }
  }
  return next;
}

export function sanitizeShellTabOrderByWorkspace(
  value: unknown,
): Record<string, WorkspaceShellTabKey[]> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const next: Record<string, WorkspaceShellTabKey[]> = {};
  for (const [workspaceId, order] of Object.entries(value)) {
    if (!Array.isArray(order)) {
      continue;
    }
    const sanitized = sanitizeWorkspaceShellTabKeys(order)
      .filter((key) => !isTransientChatTabKey(key));
    if (sanitized.length > 0) {
      next[workspaceId] = sanitized;
    }
  }
  return next;
}

function isTransientChatTabKey(key: string): boolean {
  const parsed = parseWorkspaceShellTabKey(key);
  return parsed?.kind === "chat" && isTransientClientSessionId(parsed.sessionId);
}
