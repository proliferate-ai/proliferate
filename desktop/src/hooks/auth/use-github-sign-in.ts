import { useCallback, useState } from "react";
import { CAPABILITY_COPY } from "@/config/capabilities";
import { useGitHubDesktopAuthAvailability } from "@/hooks/auth/use-github-auth-availability";
import { useAppCapabilities } from "@/hooks/capabilities/use-app-capabilities";
import { useAuthActions } from "@/hooks/auth/use-auth-actions";

export interface UseGitHubSignInResult {
  signIn: () => Promise<void>;
  submitting: boolean;
  error: string | null;
  signInAvailable: boolean;
  signInUnavailableDescription: string;
  clearError: () => void;
}

export function useGitHubSignIn(): UseGitHubSignInResult {
  const { signInWithGitHub } = useAuthActions();
  const { cloudEnabled } = useAppCapabilities();
  const { data: githubDesktopAuthAvailable = false } = useGitHubDesktopAuthAvailability();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInAvailable = cloudEnabled && githubDesktopAuthAvailable;
  const signInUnavailableDescription = cloudEnabled
    ? CAPABILITY_COPY.githubAuthUnavailableDescription
    : CAPABILITY_COPY.githubLocalDescription;

  const signIn = useCallback(async () => {
    if (!signInAvailable) {
      setError(signInUnavailableDescription);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await signInWithGitHub();
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
    signInUnavailableDescription,
    clearError,
  };
}
