import { getProliferateClient } from "./client";
import type {
  CloudMcpOAuthFlowStatusResponse,
  StartCloudMcpOAuthFlowResponse,
} from "./client";

export async function startCloudMcpOAuthFlow(
  connectionId: string,
): Promise<StartCloudMcpOAuthFlowResponse> {
  return (await getProliferateClient().POST(
    "/v1/cloud/mcp/connections/{connection_id}/oauth/start",
    { params: { path: { connection_id: connectionId } } },
  )).data!;
}

export async function getCloudMcpOAuthFlowStatus(
  flowId: string,
): Promise<CloudMcpOAuthFlowStatusResponse> {
  return (await getProliferateClient().GET("/v1/cloud/mcp/oauth/flows/{flow_id}", {
    params: { path: { flow_id: flowId } },
  })).data!;
}

export async function cancelCloudMcpOAuthFlow(
  flowId: string,
): Promise<CloudMcpOAuthFlowStatusResponse> {
  return (await getProliferateClient().POST("/v1/cloud/mcp/oauth/flows/{flow_id}/cancel", {
    params: { path: { flow_id: flowId } },
  })).data!;
}
