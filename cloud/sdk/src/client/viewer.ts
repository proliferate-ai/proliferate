import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { AuthViewerResponse } from "../types/auth.js";

export async function getAuthViewer(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<AuthViewerResponse> {
  return client.requestJson<AuthViewerResponse>({
    method: "GET",
    path: "/v1/auth/viewer",
  });
}
