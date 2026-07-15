import { type ReactNode } from "react";
import { CloudAuthUnavailablePane } from "@/components/settings/panes/CloudAuthUnavailablePane";
import { CloudSignInRequiredPane } from "@/components/settings/panes/CloudSignInRequiredPane";
import { CloudUnavailablePane } from "@/components/settings/panes/CloudUnavailablePane";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";

export interface CloudGateFlags {
  cloudEnabled: boolean;
  cloudActive: boolean;
  cloudSignInChecking: boolean;
  cloudSignInAvailable: boolean;
}

interface CloudGuardProps {
  children: ReactNode;
  /**
   * Explicit gate flags. When omitted the guard reads
   * {@link useCloudAvailabilityState} itself — pass flags only when a caller
   * already holds them (e.g. the settings screen threads them through props).
   */
  flags?: CloudGateFlags;
}

/**
 * Single reusable cloud gate: unavailable build → sign-in states → children.
 * Mirrors the original `renderCloudGatedPane` branching exactly so every
 * cloud-gated surface (settings panes, harness cloud config) behaves the same.
 */
export function CloudGuard({ children, flags }: CloudGuardProps): ReactNode {
  const availability = useCloudAvailabilityState();
  const cloudEnabled = flags?.cloudEnabled ?? availability.cloudEnabled;
  const cloudActive = flags?.cloudActive ?? availability.cloudActive;
  const cloudSignInChecking = flags?.cloudSignInChecking ?? availability.cloudSignInChecking;
  const cloudSignInAvailable = flags?.cloudSignInAvailable ?? availability.cloudSignInAvailable;

  if (!cloudEnabled) {
    return <CloudUnavailablePane />;
  }
  if (cloudActive) {
    return children;
  }
  if (cloudSignInChecking || cloudSignInAvailable) {
    return <CloudSignInRequiredPane />;
  }
  return <CloudAuthUnavailablePane />;
}
