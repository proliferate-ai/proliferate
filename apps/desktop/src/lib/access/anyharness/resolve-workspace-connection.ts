import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { DesktopSshBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { CloudSandboxGatewayUrlSource } from "@/lib/access/cloud/cloud-sandbox-gateway";
import { resolveRuntimeTargetForWorkspace } from "./runtime-target";

export type AnyHarnessDesktopResolvedConnection = AnyHarnessResolvedConnection & {
  runtimeGeneration?: number;
  runtimeAccessKind?: "direct" | "proliferate-gateway";
};

export async function resolveWorkspaceConnection(
  runtimeUrl: string,
  workspaceId: string,
  ssh: DesktopSshBridge | null,
  cloudClient: CloudSandboxGatewayUrlSource | null,
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
