import type { PendingWorkspaceInitialSession } from "@/lib/domain/workspaces/creation/pending-entry";

export interface WorkspaceEntryOptions {
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
