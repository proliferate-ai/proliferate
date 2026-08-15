import type { PendingWorkspaceInitialSession } from "#product/lib/domain/workspaces/creation/pending-entry";

export interface WorkspaceEntryOptions {
  /**
   * Pre-minted attempt id. Launch flows that must address their own pending
   * entry later (to route the first prompt) mint it before calling.
   */
  attemptId?: string;
  lightweight?: boolean;
  latencyFlowId?: string | null;
  repoGroupKeyToExpand?: string | null;
  initialSession?: PendingWorkspaceInitialSession | null;
}

export interface WorkspaceEntryInternalOptions extends WorkspaceEntryOptions {
  throwOnFailure?: boolean;
}

export interface WorkspaceEntryResult {
  workspaceId: string;
  projectedSessionId: string | null;
}
