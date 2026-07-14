import { useEffect, useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useGitHubDesktopAuthAvailability } from "@/hooks/access/cloud/auth/use-github-auth-availability";
import { useAppCapabilities } from "@/hooks/capabilities/derived/use-app-capabilities";
import { logStartupDebug } from "@/lib/infra/measurement/debug-startup";

export function useCloudAvailabilityState() {
  const authStatus = useProductHost().auth.state.status;
  const { cloudEnabled, cloudComputeEnabled } = useAppCapabilities();
  const {
    data: githubDesktopAuthAvailable,
    isPending: githubDesktopAuthAvailabilityPending,
  } = useGitHubDesktopAuthAvailability();
  const cloudUnavailable = !cloudEnabled;
  const cloudSignInChecking = cloudEnabled && githubDesktopAuthAvailabilityPending;
  const cloudSignInAvailable = cloudEnabled && githubDesktopAuthAvailable?.enabled === true;
  const cloudAuthUnavailable = cloudEnabled && !cloudSignInChecking && !cloudSignInAvailable;
  const cloudActive = cloudComputeEnabled && authStatus === "authenticated";
  const cloudRequiresSignIn = cloudSignInAvailable && authStatus === "anonymous";

  useEffect(() => {
    logStartupDebug("cloud.availability.derived_state", {
      authStatus,
      cloudEnabled,
      githubDesktopAuthAvailable: githubDesktopAuthAvailable?.enabled ?? null,
      githubDesktopAuthAvailabilityPending,
      cloudUnavailable,
      cloudSignInChecking,
      cloudSignInAvailable,
      cloudActive,
      cloudComputeEnabled,
    });
  }, [
    authStatus,
    cloudActive,
    cloudEnabled,
    cloudSignInAvailable,
    cloudSignInChecking,
    cloudUnavailable,
    githubDesktopAuthAvailabilityPending,
    githubDesktopAuthAvailable,
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
