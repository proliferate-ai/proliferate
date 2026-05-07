import { useQuery } from "@tanstack/react-query";
import type { CloudCredentialStatus } from "@/lib/access/cloud/client";
import { ProliferateClientError } from "@/lib/access/cloud/client";
import { listCloudCredentialStatuses } from "@/lib/access/cloud/credentials";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { listSyncableCloudCredentials } from "@/platform/tauri/credentials";
import { cloudCredentialsKey } from "@/hooks/access/cloud/query-keys";

const EMPTY_CLOUD_CREDENTIAL_STATUSES: CloudCredentialStatus[] = [];

export function useCloudCredentials() {
  const { cloudActive } = useCloudAvailabilityState();

  return useQuery<CloudCredentialStatus[]>({
    queryKey: cloudCredentialsKey(),
    enabled: cloudActive,
    placeholderData: EMPTY_CLOUD_CREDENTIAL_STATUSES,
    queryFn: async () => {
      const localSources = await listSyncableCloudCredentials().catch(() => []);
      try {
        const remoteStatuses = await listCloudCredentialStatuses();
        return remoteStatuses.map((status) => ({
          ...status,
          localDetected:
            localSources.find((source) => source.provider === status.provider)?.detected
            ?? status.localDetected,
        }));
      } catch (error) {
        if (error instanceof ProliferateClientError && error.status === 401) {
          return [];
        }
        throw error;
      }
    },
  });
}
