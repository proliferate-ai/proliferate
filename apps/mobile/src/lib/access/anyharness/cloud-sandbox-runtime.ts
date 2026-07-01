import { AnyHarnessClient } from "@anyharness/sdk";
import {
  ProliferateClientError,
  type CloudWorkspaceDetail,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

export interface MobileCloudSandboxRuntimeConnection {
  runtimeUrl: string;
  authToken: string;
  anyharnessWorkspaceId: string;
  runtimeAccessKind: "proliferate-gateway";
}

export function isMobileCloudSandboxWorkspace(
  workspace: Pick<CloudWorkspaceDetail, "sandboxType"> | null | undefined,
): boolean {
  return workspace?.sandboxType === "managed_personal" || workspace?.sandboxType === "managed_shared";
}

export async function resolveMobileCloudSandboxWorkspaceConnection(input: {
  workspace: CloudWorkspaceDetail;
  productToken: string | null;
  client: ProliferateCloudClient;
}): Promise<MobileCloudSandboxRuntimeConnection> {
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
    runtimeAccessKind: "proliferate-gateway",
  };
}

export async function getMobileCloudSandboxAnyHarnessClient(input: {
  workspace: CloudWorkspaceDetail;
  productToken: string | null;
  client: ProliferateCloudClient;
}): Promise<{
  connection: MobileCloudSandboxRuntimeConnection;
  anyharness: AnyHarnessClient;
}> {
  const connection = await resolveMobileCloudSandboxWorkspaceConnection(input);
  return {
    connection,
    anyharness: new AnyHarnessClient({
      baseUrl: connection.runtimeUrl,
      authToken: connection.authToken,
    }),
  };
}
