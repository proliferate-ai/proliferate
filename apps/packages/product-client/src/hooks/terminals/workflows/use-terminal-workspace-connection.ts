import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useWorkspaceRuntimeBlock } from "#product/hooks/workspaces/derived/use-workspace-runtime-block";
import {
  resolveWorkspaceConnection,
  type ProductAnyHarnessResolvedConnection,
} from "#product/lib/access/anyharness/resolve-workspace-connection";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

export interface TerminalWorkspaceConnectionController {
  getWorkspaceRuntimeBlockReason(workspaceId: string): string | null;
  resolveTerminalWorkspaceConnection(
    workspaceId: string,
  ): Promise<ProductAnyHarnessResolvedConnection>;
  triggerSelectedCloudReconnect(workspaceId: string): void;
}

// Owns terminal workspace runtime resolution. The selected-cloud-runtime fast
// path died with the cloud sandbox stack: every terminal resolves against the
// local AnyHarness runtime.
export function useTerminalWorkspaceConnection(): TerminalWorkspaceConnectionController {
  const host = useProductHost();
  const cloudClient = host.cloud.client;
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();

  const resolveTerminalWorkspaceConnection = useCallback(async (
    workspaceId: string,
  ): Promise<ProductAnyHarnessResolvedConnection> => {
    return (await resolveWorkspaceConnection(runtimeUrl, workspaceId, cloudClient)).connection;
  }, [runtimeUrl, cloudClient]);

  const triggerSelectedCloudReconnect = useCallback((_workspaceId: string) => {
    // No cloud connection cache remains to invalidate.
  }, []);

  return {
    getWorkspaceRuntimeBlockReason,
    resolveTerminalWorkspaceConnection,
    triggerSelectedCloudReconnect,
  };
}
