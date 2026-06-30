import { AnyHarnessClient } from "@anyharness/sdk";
import type { CloudWorkspaceDetail, ProliferateCloudClient } from "@proliferate/cloud-sdk";
import {
  ensureManagedSandboxWorkspaceRuntimeConnection,
} from "@proliferate/cloud-sdk/client/managed-sandboxes";

export interface WebManagedSandboxRuntimeConnection {
  runtimeUrl: string;
  authToken: string;
  anyharnessWorkspaceId: string;
  anyharnessRepoRootId: string | null;
  runtimeGeneration: number;
  runtimeAccessKind: "proliferate-gateway";
  webSocketAuthTransport: "protocol";
}

export function isWebManagedSandboxWorkspace(
  workspace: Pick<CloudWorkspaceDetail, "sandboxType"> | null | undefined,
): boolean {
  return workspace?.sandboxType === "managed_personal" || workspace?.sandboxType === "managed_shared";
}

export async function resolveWebManagedSandboxWorkspaceConnection(input: {
  workspace: CloudWorkspaceDetail;
  productToken: string | null;
  client: ProliferateCloudClient;
}): Promise<WebManagedSandboxRuntimeConnection> {
  if (!input.productToken) {
    throw new Error("Cloud runtime unavailable. Sign in again and retry.");
  }
  const runtime = await ensureManagedSandboxWorkspaceRuntimeConnection(
    input.workspace.id,
    input.client,
  );
  return {
    runtimeUrl: runtime.gatewayAnyHarnessBaseUrl,
    authToken: input.productToken,
    anyharnessWorkspaceId: runtime.anyharnessWorkspaceId,
    anyharnessRepoRootId: runtime.anyharnessRepoRootId,
    runtimeGeneration: runtime.runtimeGeneration,
    runtimeAccessKind: "proliferate-gateway",
    webSocketAuthTransport: "protocol",
  };
}

export async function getWebManagedSandboxAnyHarnessClient(input: {
  workspace: CloudWorkspaceDetail;
  productToken: string | null;
  client: ProliferateCloudClient;
}): Promise<{
  connection: WebManagedSandboxRuntimeConnection;
  anyharness: AnyHarnessClient;
}> {
  const connection = await resolveWebManagedSandboxWorkspaceConnection(input);
  return {
    connection,
    anyharness: new AnyHarnessClient({
      baseUrl: connection.runtimeUrl,
      authToken: connection.authToken,
    }),
  };
}
