import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type {
  DesktopRuntimeBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import type { Workspace } from "@anyharness/sdk";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import type { CloudSandboxGatewayUrlSource } from "#product/lib/access/cloud/cloud-sandbox-gateway";
import type { ClearSelectionOptions } from "#product/stores/sessions/session-selection-store";
import type {
  ProductAnyHarnessResolvedConnection,
} from "#product/lib/access/anyharness/resolve-workspace-connection";

export interface WorkspaceSelectionOptions {
  force?: boolean;
  forceCold?: boolean;
  forceSessionDirectoryRefresh?: boolean;
  /**
   * Marks the pending-shell handoff, where the projected session the shell is
   * already painting must survive the selection instead of being replaced by
   * the workspace's own last-active session.
   */
  preservePending?: boolean;
  initialActiveSessionId?: string | null;
  latencyFlowId?: string | null;
  /**
   * A workspace the caller has already resolved but that may not be present in
   * the selection's internal `logicalWorkspaces`/`rawWorkspaces` snapshot yet —
   * either just created (the collections query lags creation) or being restored
   * on reopen (the snapshot read can momentarily miss a workspace the reactive
   * hooks already have). When set and its id matches `workspaceId`, selection
   * uses it directly instead of failing with "Workspace not found."
   */
  knownWorkspace?: Workspace | null;
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
  /**
   * Abort signal for this selection, owned by the selection store and captured
   * the instant this selection took ownership (UX Latency ADR §4.6, Rung 9 /
   * Q11). A newer selection aborts it; the bootstrap chain threads it onto its
   * fetches so superseded requests are cancelled on the wire.
   */
  abortSignal: AbortSignal;
}

export interface WorkspaceSelectionDeps {
  localRuntime: DesktopRuntimeBridge | null;
  cloudClient: CloudSandboxGatewayUrlSource | null;
  logicalWorkspaces: LogicalWorkspace[];
  rawWorkspaces: Workspace[];
  cache: {
    cancelPreviousWorkspaceDisplayQueries: (input: {
      runtimeUrl: string;
      previousWorkspaceIds: readonly (string | null | undefined)[];
      nextWorkspaceIds: readonly (string | null | undefined)[];
    }) => void;
  };
  /**
   * Warm the global agent catalog in the background (UX Latency ADR §4.6, Rung
   * 10 / Q12). The catalog is a global cloud document with no dependency on this
   * workspace's connection, so it must not sit serially behind the blocking
   * connection resolution and session-directory fetch. Selection fires this
   * fire-and-forget at entry so the catalog races the whole connection/directory
   * chain; the composer-submit gate then reads an already-warm result. Being
   * global, it cannot paint wrong-workspace content, so it needs no abort guard.
   */
  prefetchAgentCatalog?: () => void;
  setSelectedLogicalWorkspaceId: (logicalWorkspaceId: string | null) => void;
  setSelectedWorkspace: (
    id: string,
    opts?: { initialActiveSessionId?: string | null },
  ) => void;
  removeWorkspaceSlots: (workspaceId: string) => void;
  clearSelection: (options?: ClearSelectionOptions) => void;
  bootstrapWorkspace: (input: {
    workspaceId: string;
    logicalWorkspaceId: string;
    workspaceConnection: AnyHarnessResolvedConnection;
    startedAt: number;
    latencyFlowId?: string | null;
    forceSessionDirectoryRefresh?: boolean;
    isCurrent: () => boolean;
    /** Selection abort signal; a newer selection cancels this bootstrap's fetches on the wire. */
    signal: AbortSignal;
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
  | { kind: "cloud-missing"; cloudWorkspaceId: string }
  | { kind: "stale"; cloudWorkspaceId: string | null };

export type ReadyCloudReadinessResult = Extract<
  CloudReadinessResult,
  { kind: "local" }
>;

export interface WorkspaceConnectionResult {
  runtimeUrl: string;
  workspaceConnection: ProductAnyHarnessResolvedConnection;
  materializedWorkspaceId?: string | null;
}
