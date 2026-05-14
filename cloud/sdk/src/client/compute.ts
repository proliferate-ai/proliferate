import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  RevokeWorkersResponse,
  SafeStopCheckResponse,
  SetDesiredVersionsRequest,
  SetDesiredVersionsResponse,
} from "../types/index.js";

export async function setDesiredVersions(
  targetId: string,
  body: SetDesiredVersionsRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SetDesiredVersionsResponse> {
  return client.requestJson<SetDesiredVersionsResponse>({
    method: "POST",
    path: "/v1/cloud/compute/targets/{target_id}/desired-versions",
    pathParams: { target_id: targetId },
    body,
  });
}

export async function checkSafeStop(
  targetId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SafeStopCheckResponse> {
  return client.requestJson<SafeStopCheckResponse>({
    method: "POST",
    path: "/v1/cloud/compute/targets/{target_id}/safe-stop-check",
    pathParams: { target_id: targetId },
  });
}

export async function revokeWorkers(
  targetId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<RevokeWorkersResponse> {
  return client.requestJson<RevokeWorkersResponse>({
    method: "POST",
    path: "/v1/cloud/compute/targets/{target_id}/revoke-workers",
    pathParams: { target_id: targetId },
  });
}
