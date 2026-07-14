import { useCallback, useState } from "react";
import { useAuditedAuth } from "@/hooks/auth/facade/use-audited-auth";
import { useSsoDiscovery } from "@/hooks/access/cloud/auth/use-sso-discovery";
import { useAppCapabilities } from "@/hooks/capabilities/derived/use-app-capabilities";
import { isAbortError } from "@/lib/integrations/auth/proliferate-auth";
import type { DesktopSsoSignInOptions } from "@/lib/integrations/auth/proliferate-sso-auth";

export interface UseSsoSignInResult {
  signIn: (options?: DesktopSsoSignInOptions) => Promise<void>;
  submitting: boolean;
  error: string | null;
  signInAvailable: boolean;
  signInChecking: boolean;
  signInUnavailableDescription: string;
  displayName: string | null;
  clearError: () => void;
  cancelSignIn: () => Promise<void>;
}

// Owns SSO sign-in form state and submit callback. Discovery stays in the Cloud
// access hook so the login surface can render only when deployment SSO is enabled.
export function useSsoSignIn(): UseSsoSignInResult {
  const { startLogin, cancelLogin } = useAuditedAuth();
  const { cloudEnabled } = useAppCapabilities();
  const {
    data: ssoDiscovery,
    isPending: ssoDiscoveryPending,
  } = useSsoDiscovery({ enabled: cloudEnabled });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInChecking = cloudEnabled && ssoDiscoveryPending;
  const signInAvailable = cloudEnabled && ssoDiscovery?.enabled === true;
  const signInUnavailableDescription = ssoDiscovery?.reason === "not_configured"
    ? "SSO is not configured for this environment."
    : "SSO is not available for this environment.";

  const signIn = useCallback(async (options?: DesktopSsoSignInOptions) => {
    if (!signInAvailable) {
      setError(signInUnavailableDescription);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // The host's SSO login forces `prompt: "select_account"` by default, so
      // dropping the explicit prompt here is behaviorally equivalent.
      await startLogin({
        kind: "sso",
        email: options?.email ?? undefined,
        organizationId:
          options?.organizationId ?? ssoDiscovery?.organizationId ?? undefined,
        connectionId:
          options?.connectionId ?? ssoDiscovery?.connectionId ?? undefined,
      });
    } catch (err) {
      if (isAbortError(err)) {
        setError(null);
        throw err;
      }
      setError(err instanceof Error ? err.message : "SSO sign-in failed");
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [
    signInAvailable,
    signInUnavailableDescription,
    startLogin,
    ssoDiscovery?.connectionId,
    ssoDiscovery?.organizationId,
  ]);

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
    displayName: ssoDiscovery?.displayName ?? null,
    clearError,
    cancelSignIn,
  };
}
