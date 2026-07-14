import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type { DesktopSshBridge } from "@proliferate/product-client/host/desktop-bridge";
import { resolveRuntimeTargetForWorkspace } from "./runtime-target";

export type AnyHarnessDesktopResolvedConnection = AnyHarnessResolvedConnection & {
  runtimeGeneration?: number;
  runtimeAccessKind?: "direct" | "proliferate-gateway";
};

export async function resolveWorkspaceConnection(
  runtimeUrl: string,
  workspaceId: string,
  ssh: DesktopSshBridge | null = null,
  cloudClient: ProliferateCloudClient | null = null,
): Promise<AnyHarnessDesktopResolvedConnection> {
  const target = await resolveRuntimeTargetForWorkspace(
    runtimeUrl,
    workspaceId,
    ssh,
    cloudClient,
  );
  return {
    runtimeUrl: target.baseUrl,
    authToken: target.authToken,
    webSocketAuthTransport: target.webSocketAuthTransport,
    anyharnessWorkspaceId: target.anyharnessWorkspaceId,
    runtimeGeneration: target.runtimeGeneration,
    runtimeAccessKind: target.runtimeAccessKind,
  };
}
