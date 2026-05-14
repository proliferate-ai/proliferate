import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  CloudTargetConfig,
  MaterializeTargetConfigRequest,
  MaterializeTargetConfigResponse,
} from "../types/index.js";

export async function listTargetConfigs(
  targetId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTargetConfig[]> {
  return client.requestJson<CloudTargetConfig[]>({
    method: "GET",
    path: "/v1/cloud/targets/{target_id}/configs",
    pathParams: { target_id: targetId },
  });
}

export async function getTargetConfig(
  targetId: string,
  configId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTargetConfig> {
  return client.requestJson<CloudTargetConfig>({
    method: "GET",
    path: "/v1/cloud/targets/{target_id}/configs/{config_id}",
    pathParams: { target_id: targetId, config_id: configId },
  });
}

export async function materializeTargetConfig(
  targetId: string,
  body: MaterializeTargetConfigRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<MaterializeTargetConfigResponse> {
  return client.requestJson<MaterializeTargetConfigResponse>({
    method: "POST",
    path: "/v1/cloud/targets/{target_id}/configs/materialize",
    pathParams: { target_id: targetId },
    body,
  });
}
