import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { CloudSandboxGatewayUrlSource } from "#product/lib/access/cloud/cloud-sandbox-gateway";
import { resolveRuntimeTargetForWorkspace } from "#product/lib/access/anyharness/runtime-target";
import type { WorkspaceFilesystemOrigin } from "#product/lib/domain/files/path-references";

export type ProductAnyHarnessResolvedConnection = AnyHarnessResolvedConnection & {
  runtimeGeneration: number;
  runtimeAccessKind?: "direct" | "proliferate-gateway";
};

export interface ProductResolvedWorkspaceConnection {
  connection: ProductAnyHarnessResolvedConnection;
  filesystemOrigin: WorkspaceFilesystemOrigin;
}

export async function resolveWorkspaceConnection(
  runtimeUrl: string,
  workspaceId: string,
  cloudClient: CloudSandboxGatewayUrlSource | null,
): Promise<ProductResolvedWorkspaceConnection> {
  const target = await resolveRuntimeTargetForWorkspace(
    runtimeUrl,
    workspaceId,
    cloudClient,
  );
  return {
    connection: {
      runtimeUrl: target.baseUrl,
      authToken: target.authToken,
      webSocketAuthTransport: target.webSocketAuthTransport,
      anyharnessWorkspaceId: target.anyharnessWorkspaceId,
      runtimeGeneration: target.runtimeGeneration,
      runtimeAccessKind: target.runtimeAccessKind,
    },
    filesystemOrigin: target.location === "local" ? "desktop-local" : "remote",
  };
}
