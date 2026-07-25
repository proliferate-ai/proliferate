import type {
  WorkspaceTombstones,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-collections";

/** Shared renderer authority used only by the staged/projection and durable-operation owners. */
export const sessionReplacementTombstoneState = {
  // Staged replacement state is deliberately memory-only until durable commit.
  stagedByWorkspaceId: new Map<string, WorkspaceTombstones>(),
  stagedClientAliasesByWorkspaceId: new Map<string, Set<string>>(),
  committedByWorkspaceId: new Map<string, WorkspaceTombstones>(),
  // Authoritative omission clears persistence but retains a renderer fence for
  // any older session-list response that can still arrive out of order.
  retiredSuppressionByWorkspaceId: new Map<string, WorkspaceTombstones>(),
  retiredClientAliasesByWorkspaceId: new Map<string, Set<string>>(),
  latestCommittedGeneration: 0,
  committedStorageKey: null as object | null,
};
