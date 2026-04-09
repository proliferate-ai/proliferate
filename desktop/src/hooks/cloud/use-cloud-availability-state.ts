import { useMemo } from "react";
import { useGitHubDesktopAuthAvailability } from "@/hooks/auth/use-github-auth-availability";
import { useAppCapabilities } from "@/hooks/capabilities/use-app-capabilities";
import { useAuthStore } from "@/stores/auth/auth-store";

export function useCloudAvailabilityState() {
  const authStatus = useAuthStore((state) => state.status);
  const { cloudEnabled } = useAppCapabilities();
  const { data: githubDesktopAuthAvailable = false } = useGitHubDesktopAuthAvailability();

  return useMemo(() => {
    const cloudUnavailable = !cloudEnabled;
    const cloudSignInAvailable = cloudEnabled && githubDesktopAuthAvailable;
    const cloudAuthUnavailable = cloudEnabled && !cloudSignInAvailable;
    const cloudActive = cloudEnabled && authStatus === "authenticated";
    const cloudRequiresSignIn = cloudSignInAvailable && authStatus === "anonymous";

    return {
      authStatus,
      cloudEnabled,
      cloudUnavailable,
      cloudSignInAvailable,
      cloudAuthUnavailable,
      cloudActive,
      cloudRequiresSignIn,
    };
  }, [authStatus, cloudEnabled, githubDesktopAuthAvailable]);
}
