import {
  chatWorkspaceShellTabKey,
  type WorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import type { ManualChatGroup } from "@/lib/domain/workspaces/tabs/manual-groups";

export function replaceSessionIdInOrderedList(
  values: readonly string[],
  replacedSessionId: string,
  replacementSessionId: string,
): string[] {
  if (!values.includes(replacedSessionId)) {
    return [...values];
  }
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const mapped = value === replacedSessionId ? replacementSessionId : value;
    if (!seen.has(mapped)) {
      seen.add(mapped);
      next.push(mapped);
    }
  }
  return next;
}

export function replaceSessionIdInShellTabOrder(
  values: readonly WorkspaceShellTabKey[],
  replacedSessionId: string,
  replacementSessionId: string,
): WorkspaceShellTabKey[] {
  return replaceSessionIdInOrderedList(
    values,
    chatWorkspaceShellTabKey(replacedSessionId),
    chatWorkspaceShellTabKey(replacementSessionId),
  );
}

export function replaceSessionIdInManualChatGroups(
  groups: readonly ManualChatGroup[],
  replacedSessionId: string,
  replacementSessionId: string,
): ManualChatGroup[] {
  return groups.map((group) => ({
    ...group,
    sessionIds: replaceSessionIdInOrderedList(
      group.sessionIds,
      replacedSessionId,
      replacementSessionId,
    ),
  }));
}
