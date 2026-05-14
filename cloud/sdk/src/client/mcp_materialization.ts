import { getProliferateClient } from "./core";
import type { MaterializeCloudMcpRequest, MaterializeCloudMcpResponse } from "../types";

export async function materializeCloudMcpServers(
  body: MaterializeCloudMcpRequest,
): Promise<MaterializeCloudMcpResponse> {
  return (await getProliferateClient().POST("/v1/cloud/mcp/materialize", { body })).data!;
}
