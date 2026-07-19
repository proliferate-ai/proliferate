import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import type { CloudConnectionInfo, CloudWorkspaceDetail } from "@proliferate/cloud-sdk/types";
import { isCloudAgentKind, ProliferateClientError } from "@proliferate/cloud-sdk";
import { getSandboxGatewayAccessToken } from "#product/lib/access/cloud/sandbox-gateway-access";

export const CLOUD_SANDBOX_GATEWAY_ANYHARNESS_PATH =
  "/v1/gateway/cloud-sandbox/anyharness";

/**
 * The gateway URL builder this module depends on — satisfied by the single
 * `host.cloud.client` from `useProductHost()` (or the composition-root client).
 * Passed in explicitly so product logic never reaches for the client singleton.
 */
export type CloudSandboxGatewayUrlSource = Pick<ProliferateCloudClient, "buildUrl">;

export type AnyHarnessRuntimeAccessKind = "direct" | "proliferate-gateway";

export interface CloudSandboxGatewayRuntimeConnection {
  runtimeUrl: string;
  authToken: string;
}

export function cloudSandboxGatewayRuntimeUrl(
  cloudClient: CloudSandboxGatewayUrlSource,
): string {
  return cloudClient.buildUrl(CLOUD_SANDBOX_GATEWAY_ANYHARNESS_PATH);
}

/** Resolve the user's single managed-Cloud AnyHarness runtime without a workspace target. */
export async function resolveCloudSandboxGatewayRuntimeConnection(
  cloudClient: CloudSandboxGatewayUrlSource,
  getAccessToken: () => Promise<string> = getSandboxGatewayAccessToken,
): Promise<CloudSandboxGatewayRuntimeConnection> {
  return {
    runtimeUrl: cloudSandboxGatewayRuntimeUrl(cloudClient),
    authToken: await getAccessToken(),
  };
}

export type CloudSandboxGatewayConnectionInfo = CloudConnectionInfo & {
  runtimeAccessKind: "proliferate-gateway";
  webSocketAuthTransport: "protocol";
  anyharnessRepoRootId: string | null;
};

export function isCloudSandboxGatewayConnectionInfo(
  connection: CloudConnectionInfo | null | undefined,
): connection is CloudSandboxGatewayConnectionInfo {
  return (connection as { runtimeAccessKind?: string } | null | undefined)?.runtimeAccessKind
    === "proliferate-gateway";
}

export async function withFreshCloudSandboxGatewayAccessToken<
  Connection extends CloudConnectionInfo,
>(connection: Connection): Promise<Connection> {
  if (!isCloudSandboxGatewayConnectionInfo(connection)) {
    return connection;
  }
  return {
    ...connection,
    accessToken: await getSandboxGatewayAccessToken(),
  };
}

export function resolveCloudSandboxGatewayConnectionForWorkspace(
  workspace: CloudWorkspaceDetail,
  cloudClient: CloudSandboxGatewayUrlSource | null,
): Promise<CloudSandboxGatewayConnectionInfo> {
  return resolveCloudSandboxGatewayConnectionForCloudWorkspace(
    {
      anyharnessWorkspaceId: workspace.anyharnessWorkspaceId ?? null,
      allowedAgentKinds: workspace.allowedAgentKinds,
      readyAgentKinds: workspace.readyAgentKinds,
      runtimeGeneration: workspace.runtime?.generation ?? 0,
    },
    cloudClient,
  );
}

export async function resolveCloudSandboxGatewayConnectionForCloudWorkspace(
  input: {
    anyharnessWorkspaceId: string | null;
    allowedAgentKinds?: string[];
    readyAgentKinds?: string[];
    runtimeGeneration?: number;
  },
  cloudClient: CloudSandboxGatewayUrlSource | null,
): Promise<CloudSandboxGatewayConnectionInfo> {
  if (!input.anyharnessWorkspaceId) {
    throw new ProliferateClientError(
      "Cloud workspace is missing its AnyHarness workspace id.",
      409,
      "workspace_not_ready",
    );
  }
  if (!cloudClient) {
    throw new ProliferateClientError(
      "Cloud client is unavailable; sign in to connect to a cloud workspace.",
      401,
      "cloud_client_unavailable",
    );
  }
  const productToken = await getSandboxGatewayAccessToken();
  return {
    runtimeUrl: cloudSandboxGatewayRuntimeUrl(cloudClient),
    accessToken: productToken,
    anyharnessWorkspaceId: input.anyharnessWorkspaceId,
    runtimeGeneration: input.runtimeGeneration ?? 0,
    allowedAgentKinds: (input.allowedAgentKinds ?? []).filter(isCloudAgentKind),
    readyAgentKinds: input.readyAgentKinds ?? [],
    runtimeAccessKind: "proliferate-gateway",
    webSocketAuthTransport: "protocol",
    anyharnessRepoRootId: null,
  };
}
