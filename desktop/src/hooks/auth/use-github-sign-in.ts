import { useCallback, useState } from "react";
import { CAPABILITY_COPY } from "@/config/capabilities";
import { useGitHubDesktopAuthAvailability } from "@/hooks/auth/use-github-auth-availability";
import { useAppCapabilities } from "@/hooks/capabilities/use-app-capabilities";
import { useAuthActions } from "@/hooks/auth/use-auth-actions";
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

export function useGitHubSignIn(): UseGitHubSignInResult {
  const { signInWithGitHub } = useAuthActions();
  const { cloudEnabled } = useAppCapabilities();
  const {
    data: githubDesktopAuthAvailable,
    isPending: githubDesktopAuthAvailabilityPending,
  } = useGitHubDesktopAuthAvailability();
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
