import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { CloudHarnessLaunchOptionsResponse } from "../types/harness-launch-options.js";

export async function getCloudHarnessLaunchOptions(
  cloudSandboxId: string,
  harnessKind: string,
  client: ProliferateCloudClient = getProliferateClient(),
  signal?: AbortSignal,
): Promise<CloudHarnessLaunchOptionsResponse> {
  return client.requestJson<CloudHarnessLaunchOptionsResponse>({
    method: "GET",
    path: "/v1/cloud/harness-launch-options/sandboxes/{cloud_sandbox_id}/{harness_kind}",
    pathParams: {
      cloud_sandbox_id: cloudSandboxId,
      harness_kind: harnessKind,
    },
    signal,
  });
}
