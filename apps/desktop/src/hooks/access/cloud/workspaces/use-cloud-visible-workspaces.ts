import "@/lib/access/cloud/client";

import { useVisibleCloudWorkspaces as useSdkVisibleCloudWorkspaces } from "@proliferate/cloud-sdk-react";

import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";

export function useCloudVisibleWorkspaces(enabled = true) {
  const { cloudActive } = useCloudAvailabilityState();

  return useSdkVisibleCloudWorkspaces(cloudActive && enabled);
}
