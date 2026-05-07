import { getProliferateClient } from "./client";
import type { MaterializeCloudMcpRequest, MaterializeCloudMcpResponse } from "./client";

export async function materializeCloudMcpServers(
  body: MaterializeCloudMcpRequest,
): Promise<MaterializeCloudMcpResponse> {
  return (await getProliferateClient().POST("/v1/cloud/mcp/materialize", { body })).data!;
}
