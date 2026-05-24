import "@/lib/access/cloud/client";

import {
  useCloudWorkspaces as useSdkCloudWorkspaces,
  type UseCloudWorkspacesOptions,
} from "@proliferate/cloud-sdk-react";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";

type UseCloudExposedWorkspacesOptions =
  | Omit<UseCloudWorkspacesOptions, "scope">
  | boolean;

export function useCloudExposedWorkspaces(
  options: UseCloudExposedWorkspacesOptions = {},
) {
  const { cloudActive } = useCloudAvailabilityState();
  const normalizedOptions =
    typeof options === "boolean" ? { enabled: options } : options;

  return useSdkCloudWorkspaces({
    ...normalizedOptions,
    scope: "exposed",
    enabled: cloudActive && (normalizedOptions.enabled ?? true),
  });
}
