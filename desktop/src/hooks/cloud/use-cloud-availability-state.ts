import { useEffect, useMemo } from "react";
import { useGitHubDesktopAuthAvailability } from "@/hooks/auth/use-github-auth-availability";
import { useAppCapabilities } from "@/hooks/capabilities/use-app-capabilities";
import { logStartupDebug } from "@/lib/infra/debug-startup";
import { useAuthStore } from "@/stores/auth/auth-store";

export function useCloudAvailabilityState() {
  const authStatus = useAuthStore((state) => state.status);
  const { cloudEnabled } = useAppCapabilities();
  const {
    data: githubDesktopAuthAvailable,
    isPending: githubDesktopAuthAvailabilityPending,
  } = useGitHubDesktopAuthAvailability();
  const cloudUnavailable = !cloudEnabled;
  const cloudSignInChecking = cloudEnabled && githubDesktopAuthAvailabilityPending;
  const cloudSignInAvailable = cloudEnabled && githubDesktopAuthAvailable === true;
  const cloudAuthUnavailable = cloudEnabled && !cloudSignInChecking && !cloudSignInAvailable;
  const cloudActive = cloudEnabled && authStatus === "authenticated";
  const cloudRequiresSignIn = cloudSignInAvailable && authStatus === "anonymous";

  useEffect(() => {
    logStartupDebug("cloud.availability.derived_state", {
      authStatus,
      cloudEnabled,
      githubDesktopAuthAvailable,
      githubDesktopAuthAvailabilityPending,
      cloudUnavailable,
      cloudSignInChecking,
      cloudSignInAvailable,
      cloudActive,
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
    cloudAuthUnavailable,
    cloudEnabled,
    cloudRequiresSignIn,
    cloudSignInAvailable,
    cloudSignInChecking,
    cloudUnavailable,
  ]);
}
