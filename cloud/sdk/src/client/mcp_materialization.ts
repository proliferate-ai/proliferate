import { getProliferateClient } from "./core.js";
import type { MaterializeCloudMcpRequest, MaterializeCloudMcpResponse } from "../types/index.js";

export async function materializeCloudMcpServers(
  body: MaterializeCloudMcpRequest,
): Promise<MaterializeCloudMcpResponse> {
  return (await getProliferateClient().POST("/v1/cloud/mcp/materialize", { body })).data!;
}
