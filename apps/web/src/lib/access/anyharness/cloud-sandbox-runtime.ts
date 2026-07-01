import { AnyHarnessClient } from "@anyharness/sdk";
import {
  ProliferateClientError,
  type CloudWorkspaceDetail,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

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
  const anyharnessWorkspaceId = input.workspace.anyharnessWorkspaceId;
  if (!anyharnessWorkspaceId) {
    throw new ProliferateClientError(
      "Cloud workspace runtime is not ready yet.",
      409,
      "workspace_not_ready",
    );
  }

  return {
    runtimeUrl: input.client.buildUrl("/v1/gateway/cloud-sandbox/anyharness"),
    authToken: input.productToken,
    anyharnessWorkspaceId,
    anyharnessRepoRootId: null,
    runtimeGeneration: input.workspace.runtime?.generation ?? 0,
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
