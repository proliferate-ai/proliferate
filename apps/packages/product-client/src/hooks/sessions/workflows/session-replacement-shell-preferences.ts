import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import type { ManualChatGroup } from "#product/lib/domain/workspaces/tabs/manual-groups";
import {
  replaceSessionIdInManualChatGroups,
  replaceSessionIdInOrderedList,
  replaceSessionIdInShellTabOrder,
} from "#product/lib/domain/workspaces/tabs/session-replacement";

export interface ReplacementShellPreferencesTransaction {
  rollback: () => void;
}

interface ReplacementShellPreferenceSnapshot {
  workspaceId: string;
}

/**
 * Moves only the session identity inside persisted tab preferences. Rollback
 * reverses that owned identity mapping against the live arrays, so unrelated
 * tab opens, reorders, visibility changes, and group edits survive a failed
 * replacement.
 */
export function beginReplacementShellPreferences(input: {
  shellWorkspaceId: string;
  materializedWorkspaceId: string;
  replacedSessionId: string;
  replacementSessionId: string;
}): ReplacementShellPreferencesTransaction {
  const workspaceIds = Array.from(new Set([
    input.shellWorkspaceId,
    input.materializedWorkspaceId,
  ]));
  const snapshots: ReplacementShellPreferenceSnapshot[] = [];

  for (const workspaceId of workspaceIds) {
    replaceSessionIdInShellPreferencesForWorkspace(workspaceId, input);
    snapshots.push({ workspaceId });
  }

  return {
    rollback: () => {
      for (const snapshot of snapshots) {
        replaceSessionIdInShellPreferencesForWorkspace(snapshot.workspaceId, {
          replacedSessionId: input.replacementSessionId,
          replacementSessionId: input.replacedSessionId,
        });
      }
    },
  };
}

/** One-way identity promotion after a recovered session has materialized. */
export function replaceSessionIdInShellPreferences(input: {
  shellWorkspaceId: string;
  materializedWorkspaceId: string;
  replacedSessionId: string;
  replacementSessionId: string;
}): void {
  for (const workspaceId of new Set([
    input.shellWorkspaceId,
    input.materializedWorkspaceId,
  ])) {
    replaceSessionIdInShellPreferencesForWorkspace(workspaceId, input);
  }
}

function replaceSessionIdInShellPreferencesForWorkspace(
  workspaceId: string,
  input: {
    replacedSessionId: string;
    replacementSessionId: string;
  },
): void {
  const state = useWorkspaceUiStore.getState();
  const beforeOrder = ownArray(state.shellTabOrderByWorkspace, workspaceId);
  const beforeVisible = ownArray(
    state.visibleChatSessionIdsByWorkspace,
    workspaceId,
  );
  const beforeManualGroups = ownManualGroups(
    state.manualChatGroupsByWorkspace,
    workspaceId,
  );
  const afterOrder = beforeOrder
    ? replaceSessionIdInShellTabOrder(
      beforeOrder,
      input.replacedSessionId,
      input.replacementSessionId,
    )
    : null;
  const afterVisible = beforeVisible
    ? replaceSessionIdInOrderedList(
      beforeVisible,
      input.replacedSessionId,
      input.replacementSessionId,
    )
    : null;
  const afterManualGroups = beforeManualGroups
    ? replaceSessionIdInManualChatGroups(
      beforeManualGroups,
      input.replacedSessionId,
      input.replacementSessionId,
    )
    : null;
  const changedOrder = !!afterOrder
    && !sameStringList(beforeOrder ?? [], afterOrder);
  const changedVisible = !!afterVisible
    && !sameStringList(beforeVisible ?? [], afterVisible);
  const changedManualGroups = !!afterManualGroups
    && !sameManualChatGroups(beforeManualGroups ?? [], afterManualGroups);

  if (changedOrder && afterOrder) {
    state.setShellTabOrderForWorkspace(workspaceId, afterOrder);
  }
  if (changedVisible && afterVisible) {
    state.setVisibleChatSessionIdsForWorkspace(workspaceId, afterVisible);
  }
  if (changedManualGroups && afterManualGroups) {
    state.setManualChatGroupsForWorkspace(workspaceId, afterManualGroups);
  }
}

function ownArray<T>(source: Record<string, T[]>, workspaceId: string): T[] | null {
  return Object.prototype.hasOwnProperty.call(source, workspaceId)
    ? [...(source[workspaceId] ?? [])]
    : null;
}

function ownManualGroups(
  source: Record<string, ManualChatGroup[]>,
  workspaceId: string,
): ManualChatGroup[] | null {
  return Object.prototype.hasOwnProperty.call(source, workspaceId)
    ? (source[workspaceId] ?? []).map((group) => ({
      ...group,
      sessionIds: [...group.sessionIds],
    }))
    : null;
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameManualChatGroups(
  left: readonly ManualChatGroup[],
  right: readonly ManualChatGroup[],
): boolean {
  return left.length === right.length
    && left.every((group, index) => {
      const candidate = right[index];
      return candidate !== undefined
        && group.id === candidate.id
        && group.label === candidate.label
        && group.colorId === candidate.colorId
        && sameStringList(group.sessionIds, candidate.sessionIds);
    });
}
