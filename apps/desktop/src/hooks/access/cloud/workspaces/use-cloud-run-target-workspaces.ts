import "@/lib/access/cloud/client";

import { useCloudWorkspaces } from "@proliferate/cloud-sdk-react";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";

/**
 * The user's own cloud workspaces, for the Run modal's cloud target picker
 * (spec 3.6). Disabled when cloud is unavailable so the picker hides cleanly.
 */
export function useCloudRunTargetWorkspaces(enabled = true) {
  const { cloudActive } = useCloudAvailabilityState();
  return useCloudWorkspaces({
    scope: "my",
    lifecycle: "active",
    enabled: cloudActive && enabled,
  });
}
