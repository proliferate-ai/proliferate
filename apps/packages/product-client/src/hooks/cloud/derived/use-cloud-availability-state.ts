import { useEffect, useMemo } from "react";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { logStartupDebug } from "#product/lib/infra/measurement/measurement-port";
import { useProductAuthStatus } from "#product/hooks/auth/facade/use-product-auth";

/**
 * App-wide Cloud availability, derived from the product session — NOT from
 * GitHub OAuth (PR2-AUTH-02).
 *
 * Sign-in availability is a property of the reachable product control plane:
 * ANY product session (Google / password / SSO / GitHub) unlocks the product,
 * so `cloudSignInAvailable` no longer depends on GitHub Desktop OAuth being
 * configured. GitHub App authority gates repository operations only, and is
 * resolved per-repo by the readiness resolver (`resolveRepositoryReadiness`) —
 * never here. Surfaces that specifically offer GitHub OAuth sign-in/linking
 * (the Account pane's Connect/Reconnect GitHub buttons) read the GitHub OAuth
 * availability probe directly instead of these flags.
 */
export function useCloudAvailabilityState() {
  const authStatus = useProductAuthStatus();
  const { cloudEnabled, cloudComputeEnabled } = useAppCapabilities();
  const cloudUnavailable = !cloudEnabled;
  // "Checking" means the product session itself is still resolving, not a
  // GitHub OAuth probe.
  const cloudSignInChecking = cloudEnabled && authStatus === "loading";
  // A reachable control plane always offers product sign-in.
  const cloudSignInAvailable = cloudEnabled;
  // The GitHub-OAuth-gated "sign-in unavailable" state is gone: a reachable
  // control plane always has a product sign-in path, so this is never true.
  const cloudAuthUnavailable = false;
  const cloudActive = cloudComputeEnabled && authStatus === "authenticated";
  const cloudRequiresSignIn = cloudEnabled && authStatus === "anonymous";

  useEffect(() => {
    logStartupDebug("cloud.availability.derived_state", {
      authStatus,
      cloudEnabled,
      cloudUnavailable,
      cloudSignInChecking,
      cloudSignInAvailable,
      cloudActive,
      cloudComputeEnabled,
    });
  }, [
    authStatus,
    cloudActive,
    cloudComputeEnabled,
    cloudEnabled,
    cloudSignInAvailable,
    cloudSignInChecking,
    cloudUnavailable,
  ]);

  return useMemo(() => {
    return {
      authStatus,
      cloudEnabled,
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
    cloudEnabled,
    cloudRequiresSignIn,
    cloudSignInAvailable,
    cloudSignInChecking,
    cloudUnavailable,
  ]);
}
