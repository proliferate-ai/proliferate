import { useQuery } from "@tanstack/react-query";
import {
  listCloudCredentialStatuses,
  type CloudCredentialStatus,
} from "@proliferate/cloud-sdk";
import { cloudCredentialsKey } from "../lib/query-keys";

const EMPTY_CLOUD_CREDENTIAL_STATUSES: CloudCredentialStatus[] = [];

export function useCloudCredentialStatuses(enabled = true) {
  return useQuery<CloudCredentialStatus[]>({
    queryKey: cloudCredentialsKey(),
    queryFn: listCloudCredentialStatuses,
    enabled,
    placeholderData: EMPTY_CLOUD_CREDENTIAL_STATUSES,
  });
}

