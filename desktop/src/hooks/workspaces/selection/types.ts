import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { Workspace } from "@anyharness/sdk";
import type { WorkspaceSession } from "@/hooks/sessions/use-session-selection-actions";
import type { QueryClient } from "@tanstack/react-query";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspaces";

export interface WorkspaceSelectionOptions {
  force?: boolean;
  forceCold?: boolean;
  preservePending?: boolean;
  initialActiveSessionId?: string | null;
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
  rawWorkspaces: Workspace[];
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
  reconcileHotWorkspace: (input: {
    workspaceId: string;
    logicalWorkspaceId: string;
    runtimeUrl: string;
    workspaceConnection: AnyHarnessResolvedConnection;
    sessionId: string;
    selectionNonce: number;
    latencyFlowId?: string | null;
    isCurrent: () => boolean;
  }) => Promise<"completed" | "stale" | "session_missing">;
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
