import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type {
  DesktopRuntimeBridge,
  DesktopSshBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import type { Workspace } from "@anyharness/sdk";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import type { CloudSandboxGatewayUrlSource } from "@/lib/access/cloud/cloud-sandbox-gateway";

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
  localRuntime: DesktopRuntimeBridge | null;
  ssh?: DesktopSshBridge | null;
  cloudClient: CloudSandboxGatewayUrlSource | null;
  logicalWorkspaces: LogicalWorkspace[];
  rawWorkspaces: Workspace[];
  cache: {
    cancelPreviousWorkspaceDisplayQueries: (input: {
      runtimeUrl: string;
      previousWorkspaceIds: readonly (string | null | undefined)[];
      nextWorkspaceIds: readonly (string | null | undefined)[];
    }) => void;
    invalidateCloudWorkspaceStartState: (runtimeUrl: string) => Promise<void>;
    refreshCloudWorkspaceConnection: (cloudWorkspaceId: string) => Promise<{
      runtimeUrl: string;
      accessToken?: string | null;
      anyharnessWorkspaceId?: string | null;
    }>;
  };
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
    workspaceConnection: AnyHarnessResolvedConnection;
    startedAt: number;
    latencyFlowId?: string | null;
    isCurrent: () => boolean;
  }) => Promise<{ sessions: WorkspaceSession[] }>;
  reconcileHotWorkspace: (input: {
    workspaceId: string;
    logicalWorkspaceId: string;
    workspaceConnection: AnyHarnessResolvedConnection;
    sessionId: string;
    selectionNonce: number;
    latencyFlowId?: string | null;
    isCurrent: () => boolean;
  }) => Promise<"completed" | "stale" | "session_missing">;
}

export type CloudReadinessResult =
  | { kind: "local"; runtimeWorkspaceId?: string | null }
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
  materializedWorkspaceId?: string | null;
}
