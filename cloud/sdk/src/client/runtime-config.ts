import { getProliferateClient } from "./core.js";
import type {
  RefreshRuntimeConfigRequest,
  RuntimeConfigStatusResponse,
} from "../types/index.js";

export async function getSandboxProfileRuntimeConfig(
  sandboxProfileId: string,
): Promise<RuntimeConfigStatusResponse> {
  return (await getProliferateClient().GET(
    "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/runtime-config",
    {
      params: { path: { sandbox_profile_id: sandboxProfileId } },
    },
  )).data!;
}

export async function refreshSandboxProfileRuntimeConfig(
  sandboxProfileId: string,
  body: RefreshRuntimeConfigRequest = { reason: "manual_refresh" },
): Promise<RuntimeConfigStatusResponse> {
  return (await getProliferateClient().POST(
    "/v1/cloud/sandbox-profiles/{sandbox_profile_id}/runtime-config/refresh",
    {
      params: { path: { sandbox_profile_id: sandboxProfileId } },
      body,
    },
  )).data!;
}
