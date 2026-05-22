import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  RefreshRuntimeConfigRequest,
  RuntimeConfigStatusResponse,
} from "../types/index.js";

export async function getSandboxProfileRuntimeConfig(
  sandboxProfileId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<RuntimeConfigStatusResponse> {
  return client.requestJson<RuntimeConfigStatusResponse>({
    method: "GET",
    path: "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/runtime-config",
    pathParams: { sandbox_profile_id: sandboxProfileId },
  });
}

export async function refreshSandboxProfileRuntimeConfig(
  sandboxProfileId: string,
  body: RefreshRuntimeConfigRequest = { reason: "manual_refresh" },
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<RuntimeConfigStatusResponse> {
  return client.requestJson<RuntimeConfigStatusResponse>({
    method: "POST",
    path: "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/runtime-config/refresh",
    pathParams: { sandbox_profile_id: sandboxProfileId },
    body,
  });
}
