import { AnyHarnessClient } from "@anyharness/sdk";
import type { CloudWorkspaceDetail, ProliferateCloudClient } from "@proliferate/cloud-sdk";
import {
  ensureCloudSandboxWorkspaceRuntimeConnection,
} from "@proliferate/cloud-sdk/client/cloud-sandboxes";

export interface WebCloudSandboxRuntimeConnection {
  runtimeUrl: string;
  authToken: string;
  anyharnessWorkspaceId: string;
  anyharnessRepoRootId: string | null;
  runtimeGeneration: number;
  runtimeAccessKind: "proliferate-gateway";
  webSocketAuthTransport: "protocol";
}

export function isWebCloudSandboxWorkspace(
  workspace: Pick<CloudWorkspaceDetail, "sandboxType"> | null | undefined,
): boolean {
  return workspace?.sandboxType === "managed_personal" || workspace?.sandboxType === "managed_shared";
}

export async function resolveWebCloudSandboxWorkspaceConnection(input: {
  workspace: CloudWorkspaceDetail;
  productToken: string | null;
  client: ProliferateCloudClient;
}): Promise<WebCloudSandboxRuntimeConnection> {
  if (!input.productToken) {
    throw new Error("Cloud runtime unavailable. Sign in again and retry.");
  }
  const runtime = await ensureCloudSandboxWorkspaceRuntimeConnection(
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

export async function getWebCloudSandboxAnyHarnessClient(input: {
  workspace: CloudWorkspaceDetail;
  productToken: string | null;
  client: ProliferateCloudClient;
}): Promise<{
  connection: WebCloudSandboxRuntimeConnection;
  anyharness: AnyHarnessClient;
}> {
  const connection = await resolveWebCloudSandboxWorkspaceConnection(input);
  return {
    connection,
    anyharness: new AnyHarnessClient({
      baseUrl: connection.runtimeUrl,
      authToken: connection.authToken,
    }),
  };
}
