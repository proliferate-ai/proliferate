import { useCallback, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { LoginRequest } from "@proliferate/product-client/host/product-host";
import { useSsoDiscovery } from "@/hooks/access/cloud/auth/use-sso-discovery";
import { useAppCapabilities } from "@/hooks/capabilities/derived/use-app-capabilities";

type SsoSignInOptions = Omit<
  Extract<LoginRequest, { kind: "sso" }>,
  "kind"
>;

export interface UseSsoSignInResult {
  signIn: (options?: SsoSignInOptions) => Promise<void>;
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
  const { auth } = useProductHost();
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

  const signIn = useCallback(async (options?: SsoSignInOptions) => {
    if (!signInAvailable) {
      setError(signInUnavailableDescription);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await auth.startLogin({
        kind: "sso",
        organizationId: ssoDiscovery?.organizationId ?? undefined,
        connectionId: ssoDiscovery?.connectionId ?? undefined,
        prompt: "select_account",
        ...options,
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
    auth,
    ssoDiscovery?.connectionId,
    ssoDiscovery?.organizationId,
  ]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const cancelSignIn = useCallback(async () => {
    setSubmitting(false);
    setError(null);
    await auth.cancelLogin();
  }, [auth]);

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

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}
