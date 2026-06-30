import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import { legacyOpenApiClient } from "./legacy.js";
import type {
  CloudMcpOAuthFlowStatusResponse,
  StartCloudMcpOAuthFlowRequest,
  StartCloudMcpOAuthFlowResponse,
} from "../types/index.js";

export async function startCloudMcpOAuthFlow(
  connectionId: string,
  options?: StartCloudMcpOAuthFlowRequest,
): Promise<StartCloudMcpOAuthFlowResponse>;
export async function startCloudMcpOAuthFlow(
  connectionId: string,
  client?: ProliferateCloudClient,
): Promise<StartCloudMcpOAuthFlowResponse>;
export async function startCloudMcpOAuthFlow(
  connectionId: string,
  options?: StartCloudMcpOAuthFlowRequest,
  client?: ProliferateCloudClient,
): Promise<StartCloudMcpOAuthFlowResponse>;
export async function startCloudMcpOAuthFlow(
  connectionId: string,
  optionsOrClient?: StartCloudMcpOAuthFlowRequest | ProliferateCloudClient,
  maybeClient?: ProliferateCloudClient,
): Promise<StartCloudMcpOAuthFlowResponse> {
  const { body, client } = resolveStartOAuthArgs(optionsOrClient, maybeClient);
  return (await legacyOpenApiClient(client).POST(
    "/v1/cloud/mcp/connections/{connection_id}/oauth/start",
    {
      params: { path: { connection_id: connectionId } },
      ...(body ? { body } : {}),
    },
  )).data!;
}

export async function getCloudMcpOAuthFlowStatus(
  flowId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpOAuthFlowStatusResponse> {
  return (await legacyOpenApiClient(client).GET("/v1/cloud/mcp/oauth/flows/{flow_id}", {
    params: { path: { flow_id: flowId } },
  })).data!;
}

export async function cancelCloudMcpOAuthFlow(
  flowId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpOAuthFlowStatusResponse> {
  return (await legacyOpenApiClient(client).POST("/v1/cloud/mcp/oauth/flows/{flow_id}/cancel", {
    params: { path: { flow_id: flowId } },
  })).data!;
}

function resolveStartOAuthArgs(
  optionsOrClient?: StartCloudMcpOAuthFlowRequest | ProliferateCloudClient,
  maybeClient?: ProliferateCloudClient,
): {
  body?: StartCloudMcpOAuthFlowRequest;
  client: ProliferateCloudClient;
} {
  if (isProliferateCloudClient(optionsOrClient)) {
    return { client: optionsOrClient };
  }
  return {
    body: optionsOrClient,
    client: maybeClient ?? getProliferateClient(),
  };
}

function isProliferateCloudClient(
  value: StartCloudMcpOAuthFlowRequest | ProliferateCloudClient | undefined,
): value is ProliferateCloudClient {
  return typeof value === "object" && value !== null && "GET" in value && "POST" in value;
}
