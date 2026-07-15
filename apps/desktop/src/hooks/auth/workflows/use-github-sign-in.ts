import { useCallback, useState } from "react";
import { useAuditedAuth } from "@/hooks/auth/facade/use-audited-auth";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { useGitHubDesktopAuthAvailability } from "@/hooks/access/cloud/auth/use-github-auth-availability";
import { useAppCapabilities } from "@/hooks/capabilities/derived/use-app-capabilities";
import {
  isAbortError,
  type GitHubDesktopSignInOptions,
} from "@/lib/integrations/auth/proliferate-auth";

export interface UseGitHubSignInResult {
  signIn: (options?: GitHubDesktopSignInOptions) => Promise<void>;
  submitting: boolean;
  error: string | null;
  signInAvailable: boolean;
  signInChecking: boolean;
  signInUnavailableDescription: string;
  clearError: () => void;
  cancelSignIn: () => Promise<void>;
}

// Owns GitHub sign-in form state and submit callback. Does not own auth availability access.
// The availability probe runs whenever this hook is mounted — the persistent auth shell mounts
// it during the loading phase too, so the answer is warm before the sign-in button morphs in,
// otherwise the first-load pending window flashes a "checking…" state during the loading -> auth
// transition. The query self-guards on control-plane reachability.
export function useGitHubSignIn(): UseGitHubSignInResult {
  const { startLogin, cancelLogin } = useAuditedAuth();
  const { cloudEnabled } = useAppCapabilities();
  const {
    data: githubDesktopAuthAvailable,
    isPending: githubDesktopAuthAvailabilityPending,
  } = useGitHubDesktopAuthAvailability();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInChecking = cloudEnabled && githubDesktopAuthAvailabilityPending;
  const signInAvailable = cloudEnabled && githubDesktopAuthAvailable?.enabled === true;
  const signInUnavailableDescription = cloudEnabled
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
      await startLogin({ kind: "github", prompt: options?.prompt });
    } catch (err) {
      if (isAbortError(err)) {
        setError(null);
        throw err;
      }
      setError(err instanceof Error ? err.message : "GitHub sign-in failed");
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [signInAvailable, signInUnavailableDescription, startLogin]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const cancelSignIn = useCallback(async () => {
    setSubmitting(false);
    setError(null);
    await cancelLogin();
  }, [cancelLogin]);

  return {
    signIn,
    submitting,
    error,
    signInAvailable,
    signInChecking,
    signInUnavailableDescription,
    clearError,
    cancelSignIn,
  };
}
