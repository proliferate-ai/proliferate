import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";

const clientAuthorityIds = new WeakMap<ProliferateCloudClient, number>();
let nextClientAuthorityId = 1;

/**
 * Extend the credential-free deployment/actor scope with the exact Cloud
 * client instance that owns connection data. Client identity is process-local
 * and contains no token or credential material.
 */
export function buildCloudConnectionAuthorityScopeKey(
  baseScopeKey: string,
  cloudClient: ProliferateCloudClient | null,
): string {
  if (!cloudClient) {
    return `${baseScopeKey}::cloud-client:unavailable`;
  }

  let clientId = clientAuthorityIds.get(cloudClient);
  if (clientId === undefined) {
    clientId = nextClientAuthorityId;
    nextClientAuthorityId += 1;
    clientAuthorityIds.set(cloudClient, clientId);
  }
  return `${baseScopeKey}::cloud-client:${clientId}`;
}
