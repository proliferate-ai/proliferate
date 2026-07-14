import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";

export const CLOUD_ACCESS_UNAVAILABLE_MESSAGE =
  "Cloud access is unavailable for this host.";

export function requireHostCloudClient(
  client: ProliferateCloudClient | null,
): ProliferateCloudClient {
  if (!client) throw new Error(CLOUD_ACCESS_UNAVAILABLE_MESSAGE);
  return client;
}
