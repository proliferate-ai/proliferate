import {
  chatWorkspaceShellTabKey,
  type WorkspaceShellTabKey,
} from "#product/lib/domain/workspaces/tabs/shell-tabs";
import type { ManualChatGroup } from "#product/lib/domain/workspaces/tabs/manual-groups";

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
  const replacementOwnerIndex = groups.findIndex((group) =>
    group.sessionIds.includes(replacedSessionId)
  );
  const mappedGroups = groups.map((group) => ({
    ...group,
    sessionIds: replaceSessionIdInOrderedList(
      group.sessionIds,
      replacedSessionId,
      replacementSessionId,
    ),
  }));
  if (replacementOwnerIndex < 0) {
    return mappedGroups;
  }

  const assignedSessionIds = new Set<string>();
  return mappedGroups.map((group, groupIndex) => ({
    ...group,
    sessionIds: group.sessionIds.filter((sessionId) => {
      if (
        sessionId === replacementSessionId
        && groupIndex !== replacementOwnerIndex
      ) {
        return false;
      }
      if (assignedSessionIds.has(sessionId)) {
        return false;
      }
      assignedSessionIds.add(sessionId);
      return true;
    }),
  }));
}
