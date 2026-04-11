import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { WorkspaceSession } from "@/hooks/sessions/use-session-selection-actions";
import type { QueryClient } from "@tanstack/react-query";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";

export interface WorkspaceSelectionOptions {
  force?: boolean;
  preservePending?: boolean;
  latencyFlowId?: string | null;
}

export interface WorkspaceSelectionRequest {
  workspaceId: string;
  options?: WorkspaceSelectionOptions;
}

export interface WorkspaceSelectionContext {
  workspaceId: string;
  logicalWorkspaceId: string;
  selectionNonce: number;
  selectionStartedAt: number;
  cloudWorkspaceId: string | null;
}

export interface WorkspaceSelectionDeps {
  queryClient: QueryClient;
  logicalWorkspaces: LogicalWorkspace[];
  setSelectedLogicalWorkspaceId: (logicalWorkspaceId: string | null) => void;
  setSelectedWorkspace: (
    id: string,
    opts?: { initialActiveSessionId?: string | null; clearPending?: boolean },
  ) => void;
  removeWorkspaceSlots: (workspaceId: string) => void;
  clearSelection: () => void;
  bootstrapWorkspace: (input: {
    workspaceId: string;
    logicalWorkspaceId: string;
    runtimeUrl: string;
    workspaceConnection: AnyHarnessResolvedConnection;
    startedAt: number;
    latencyFlowId?: string | null;
    isCurrent: () => boolean;
  }) => Promise<{ sessions: WorkspaceSession[] }>;
}

export type CloudReadinessResult =
  | { kind: "local" }
  | { kind: "cloud-ready"; cloudWorkspaceId: string }
  | { kind: "cloud-pending"; cloudWorkspaceId: string; status: string }
  | { kind: "cloud-missing"; cloudWorkspaceId: string }
  | { kind: "stale"; cloudWorkspaceId: string | null };

export type ReadyCloudReadinessResult = Extract<
  CloudReadinessResult,
  { kind: "local" | "cloud-ready" }
>;

export interface WorkspaceConnectionResult {
  runtimeUrl: string;
  workspaceConnection: AnyHarnessResolvedConnection;
}
