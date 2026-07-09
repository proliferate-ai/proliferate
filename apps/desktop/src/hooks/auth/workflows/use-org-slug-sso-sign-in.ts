import { useCallback, useState } from "react";
import { useAuthActions } from "@/hooks/auth/workflows/use-auth-actions";
import { isAbortError } from "@/lib/integrations/auth/proliferate-auth";
import { discoverDesktopSso } from "@/lib/integrations/auth/proliferate-sso-auth";

// A slug that does not resolve to enabled SSO returns the same generic answer
// whether the org is missing, has no SSO, or has it disabled, so we surface one
// generic message and never confirm which orgs exist.
const SLUG_UNAVAILABLE =
  "We could not find single sign-on for that workspace. Check the sign-in link your admin shared.";

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
  const { signInWithSso } = useAuthActions();
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
      const discovery = await discoverDesktopSso({ slug: trimmed });
      if (!discovery.enabled || !discovery.organizationId) {
        setError(SLUG_UNAVAILABLE);
        return false;
      }
      await signInWithSso({
        organizationId: discovery.organizationId,
        connectionId: discovery.connectionId,
        prompt: "select_account",
      });
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
  }, [signInWithSso]);

  const clearError = useCallback(() => setError(null), []);

  return { signIn, submitting, error, clearError };
}
