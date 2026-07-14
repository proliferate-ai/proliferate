import { useCallback, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useDesktopAuthMethods } from "@/hooks/access/cloud/auth/use-auth-methods";
import { useAppCapabilities } from "@/hooks/capabilities/derived/use-app-capabilities";

export interface UsePasswordSignInResult {
  signIn: (email: string, password: string) => Promise<void>;
  submitting: boolean;
  error: string | null;
  signInAvailable: boolean;
  signInChecking: boolean;
  clearError: () => void;
}

// Owns email/password sign-in form state and submit callback. Availability
// comes from the server's public auth-methods probe so the login surface can
// show the form only when the connected server supports password login.
export function usePasswordSignIn(): UsePasswordSignInResult {
  const { auth } = useProductHost();
  const { cloudEnabled } = useAppCapabilities();
  const {
    data: authMethods,
    isPending: authMethodsPending,
  } = useDesktopAuthMethods();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInChecking = cloudEnabled && authMethodsPending;
  const signInAvailable = cloudEnabled && authMethods?.passwordLogin === true;

  const signIn = useCallback(async (email: string, password: string) => {
    if (!signInAvailable) {
      setError("Email sign-in is not available for this environment.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await auth.startLogin({ kind: "password", email, password });
    } catch (err) {
      if (isAbortError(err)) {
        setError(null);
        throw err;
      }
      setError(err instanceof Error ? err.message : "Sign-in failed");
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [auth, signInAvailable]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    signIn,
    submitting,
    error,
    signInAvailable,
    signInChecking,
    clearError,
  };
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}
