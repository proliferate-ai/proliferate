import { useCallback, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { isAbortError } from "@/lib/integrations/auth/proliferate-auth";

export interface UseOrgSlugSsoSignInResult {
  signIn: (slug: string) => Promise<boolean>;
  submitting: boolean;
  error: string | null;
  clearError: () => void;
}

// Drives org-scoped SSO from a workspace slug on cold login: resolve the slug to
// the org's SSO connection, then hand off to the existing native SSO machinery
// (system browser + proliferate://auth/callback deep link).
export function useOrgSlugSsoSignIn(): UseOrgSlugSsoSignInResult {
  const { startLogin } = useProductHost().auth;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async (slug: string): Promise<boolean> => {
    const trimmed = slug.trim();
    if (!trimmed) {
      setError("Enter your organization's workspace name to continue.");
      return false;
    }
    setSubmitting(true);
    setError(null);
    try {
      // The host resolves the slug's SSO connection and forces
      // `prompt: "select_account"`; a slug that does not resolve to enabled SSO
      // throws the same generic "could not find single sign-on" message,
      // never confirming which orgs exist.
      await startLogin({ kind: "sso", slug: trimmed });
      return true;
    } catch (err) {
      if (isAbortError(err)) {
        setError(null);
        return false;
      }
      setError(err instanceof Error ? err.message : "SSO sign-in failed");
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [startLogin]);

  const clearError = useCallback(() => setError(null), []);

  return { signIn, submitting, error, clearError };
}
