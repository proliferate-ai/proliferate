import { useEffect, useMemo } from "react";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { logStartupDebug } from "#product/lib/infra/measurement/measurement-port";
import { useProductAuthStatus } from "#product/hooks/auth/facade/use-product-auth";

/**
 * App-wide Cloud availability, derived from the product session — NOT from
 * GitHub OAuth (PR2-AUTH-02).
 *
 * Sign-in availability is a property of the reachable product control plane:
 * ANY product session (Google / password / GitHub) unlocks the product,
 * so `cloudSignInAvailable` no longer depends on GitHub Desktop OAuth being
 * configured. GitHub App authority gates repository operations only, and is
 * resolved per-repo by the readiness resolver (`resolveRepositoryReadiness`) —
 * never here. Surfaces that specifically offer GitHub OAuth sign-in/linking
 * (the Account pane's Connect/Reconnect GitHub buttons) read the GitHub OAuth
 * availability probe directly instead of these flags.
 */
let lastLoggedCloudAvailabilityState: string | null = null;

export function useCloudAvailabilityState() {
  const authStatus = useProductAuthStatus();
  const { controlPlaneReachable, cloudComputeEnabled } = useAppCapabilities();
  const cloudUnavailable = !controlPlaneReachable;
  // "Checking" means the product session itself is still resolving, not a
  // GitHub OAuth probe.
  const cloudSignInChecking = controlPlaneReachable && authStatus === "loading";
  // A reachable control plane always offers product sign-in.
  const cloudSignInAvailable = controlPlaneReachable;
  // The GitHub-OAuth-gated "sign-in unavailable" state is gone: a reachable
  // control plane always has a product sign-in path, so this is never true.
  const cloudAuthUnavailable = false;
  const cloudActive = cloudComputeEnabled && authStatus === "authenticated";
  const cloudRequiresSignIn = controlPlaneReachable && authStatus === "anonymous";

  useEffect(() => {
    const derivedState = {
      authStatus,
      controlPlaneReachable,
      cloudUnavailable,
      cloudSignInChecking,
      cloudSignInAvailable,
      cloudActive,
      cloudComputeEnabled,
    };
    // This hook has many concurrent consumers, and each mount re-ran the log
    // with identical values: it produced 909 of the 1,196 records in the
    // 2026-08-13 dogfood run. The dedupe is module-scoped because the
    // duplication is across hook instances, which a component ref cannot see.
    const derivedStateKey = JSON.stringify(derivedState);
    if (derivedStateKey === lastLoggedCloudAvailabilityState) {
      return;
    }
    lastLoggedCloudAvailabilityState = derivedStateKey;
    logStartupDebug("cloud.availability.derived_state", derivedState);
  }, [
    authStatus,
    cloudActive,
    cloudComputeEnabled,
    controlPlaneReachable,
    cloudSignInAvailable,
    cloudSignInChecking,
    cloudUnavailable,
  ]);

  return useMemo(() => {
    return {
      authStatus,
      controlPlaneReachable,
      cloudComputeEnabled,
      cloudUnavailable,
      cloudSignInChecking,
      cloudSignInAvailable,
      cloudAuthUnavailable,
      cloudActive,
      cloudRequiresSignIn,
    };
  }, [
    authStatus,
    cloudActive,
    cloudComputeEnabled,
    cloudAuthUnavailable,
    controlPlaneReachable,
    cloudRequiresSignIn,
    cloudSignInAvailable,
    cloudSignInChecking,
    cloudUnavailable,
  ]);
}
