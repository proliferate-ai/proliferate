import { useCallback, useState } from "react";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { useGitHubDesktopAuthAvailability } from "@/hooks/access/cloud/auth/use-github-auth-availability";
import { useAppCapabilities } from "@/hooks/capabilities/derived/use-app-capabilities";
import { useAuthActions } from "@/hooks/auth/workflows/use-auth-actions";
import type { GitHubDesktopSignInOptions } from "@/lib/integrations/auth/proliferate-auth";

export interface UseGitHubSignInResult {
  signIn: (options?: GitHubDesktopSignInOptions) => Promise<void>;
  submitting: boolean;
  error: string | null;
  signInAvailable: boolean;
  signInChecking: boolean;
  signInUnavailableDescription: string;
  clearError: () => void;
}

// Owns GitHub sign-in form state and submit callback. Does not own auth availability access.
// `enabled` can gate the availability poll for on-demand callers. The auth shell leaves it
// enabled during the loading phase too, so the availability answer is warm before the sign-in
// button morphs in — otherwise the first-load pending window flashes a "checking…" state
// during the loading -> auth transition.
export function useGitHubSignIn(options?: { enabled?: boolean }): UseGitHubSignInResult {
  const { signInWithGitHub } = useAuthActions();
  const { cloudEnabled } = useAppCapabilities();
  const {
    data: githubDesktopAuthAvailable,
    isPending: githubDesktopAuthAvailabilityPending,
  } = useGitHubDesktopAuthAvailability({ enabled: options?.enabled ?? true });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInChecking = cloudEnabled && githubDesktopAuthAvailabilityPending;
  const signInAvailable = cloudEnabled && githubDesktopAuthAvailable?.enabled === true;
  const signInUnavailableDescription = signInChecking
    ? CAPABILITY_COPY.githubAuthCheckingDescription
    : cloudEnabled
      ? CAPABILITY_COPY.githubAuthUnavailableDescription
    : CAPABILITY_COPY.githubLocalDescription;

  const signIn = useCallback(async (options?: GitHubDesktopSignInOptions) => {
    if (!signInAvailable) {
      setError(signInUnavailableDescription);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await signInWithGitHub(options);
    } catch (err) {
      setError(err instanceof Error ? err.message : "GitHub sign-in failed");
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [signInAvailable, signInUnavailableDescription, signInWithGitHub]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    signIn,
    submitting,
    error,
    signInAvailable,
    signInChecking,
    signInUnavailableDescription,
    clearError,
  };
}
