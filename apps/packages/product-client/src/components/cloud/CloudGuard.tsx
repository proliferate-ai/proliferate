import { type ReactNode } from "react";
import { CloudAuthUnavailablePane } from "#product/components/settings/panes/CloudAuthUnavailablePane";
import { CloudNotConfiguredPane } from "#product/components/settings/panes/CloudNotConfiguredPane";
import { CloudSignInRequiredPane } from "#product/components/settings/panes/CloudSignInRequiredPane";
import { CloudUnavailablePane } from "#product/components/settings/panes/CloudUnavailablePane";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";

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
   * The true-cause signals (authStatus, cloudComputeEnabled) are always read
   * from the hook, since the flags shape predates them and every caller renders
   * within the same provider.
   */
  flags?: CloudGateFlags;
}

/**
 * Single reusable cloud gate. Branches on the TRUE cause so a signed-in user is
 * never shown a "Sign in" CTA for an operator problem (PR2-GATING-01 class):
 *
 * - build/deployment unreachable → CloudUnavailablePane
 * - cloud active → children
 * - signed in but cloud compute not operator-configured → the truthful
 *   operator-configuration pane (never sign-in)
 * - anonymous / loading (sign-in is the real next step) → CloudSignInRequiredPane
 * - otherwise → CloudAuthUnavailablePane
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
  // Signed in, but cloud compute is not operator-configured: the block is an
  // operator problem, not a missing session. Show the truthful operator pane
  // rather than a "Sign in" CTA the already-signed-in user cannot act on.
  if (availability.authStatus === "authenticated" && !availability.cloudComputeEnabled) {
    return <CloudNotConfiguredPane />;
  }
  if (cloudSignInChecking || cloudSignInAvailable) {
    return <CloudSignInRequiredPane />;
  }
  return <CloudAuthUnavailablePane />;
}
