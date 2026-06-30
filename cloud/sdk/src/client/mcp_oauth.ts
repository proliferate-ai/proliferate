import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import {
  cancelIntegrationOAuthFlow,
  getIntegrationOAuthFlowStatus,
  startIntegrationOAuthFlow,
} from "./integrations.js";
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
  return await startIntegrationOAuthFlow(connectionId, body, client);
}

export async function getCloudMcpOAuthFlowStatus(
  flowId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpOAuthFlowStatusResponse> {
  return await getIntegrationOAuthFlowStatus(flowId, client);
}

export async function cancelCloudMcpOAuthFlow(
  flowId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudMcpOAuthFlowStatusResponse> {
  return await cancelIntegrationOAuthFlow(flowId, client);
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
