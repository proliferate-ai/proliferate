import { useQuery } from "@tanstack/react-query";
import {
  listCloudCredentialStatuses,
  type CloudCredentialStatus,
} from "@proliferate/cloud-sdk";
import { cloudCredentialsKey } from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

const EMPTY_CLOUD_CREDENTIAL_STATUSES: CloudCredentialStatus[] = [];

export function useCloudCredentialStatuses(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudCredentialStatus[]>({
    queryKey: cloudCredentialsKey(),
    queryFn: () => listCloudCredentialStatuses(client),
    enabled,
    placeholderData: EMPTY_CLOUD_CREDENTIAL_STATUSES,
  });
}
