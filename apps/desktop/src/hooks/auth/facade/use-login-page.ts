import { useLocation, useNavigate } from "react-router-dom";
import { useGitHubSignIn } from "@/hooks/auth/workflows/use-github-sign-in";
import { useSsoSignIn } from "@/hooks/auth/workflows/use-sso-sign-in";
import { isProductAuthRequired } from "@/lib/domain/auth/auth-mode";
import { useAuthStore } from "@/stores/auth/auth-store";
import { getRedirectTarget } from "@/lib/domain/auth/login-redirect";

// Owns the login page view model by composing auth state and sign-in actions.
export function useLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const status = useAuthStore((state) => state.status);
  const {
    signIn,
    submitting,
    error,
    signInAvailable: githubSignInAvailable,
    signInChecking: githubSignInChecking,
    signInUnavailableDescription: githubSignInUnavailableDescription,
    cancelSignIn: cancelGitHubSignIn,
  } = useGitHubSignIn();
  const {
    signIn: signInWithSso,
    submitting: ssoSubmitting,
    error: ssoError,
    signInAvailable: ssoSignInAvailable,
    signInChecking: ssoSignInChecking,
    signInUnavailableDescription: ssoSignInUnavailableDescription,
    displayName: ssoDisplayName,
    cancelSignIn: cancelSsoSignIn,
  } = useSsoSignIn();
  const canContinueLocally = !isProductAuthRequired();

  const redirectTarget = getRedirectTarget(location.state);
  const busy = submitting || ssoSubmitting || status === "bootstrapping";

  async function handleGitHubSignIn() {
    try {
      await signIn();
      navigate(redirectTarget, { replace: true });
    } catch {
      // error is already surfaced via the hook's `error` state
    }
  }

  async function handleSsoSignIn() {
    try {
      await signInWithSso();
      navigate(redirectTarget, { replace: true });
    } catch {
      // error is already surfaced via the hook's `error` state
    }
  }

  function handleContinueLocally() {
    navigate(redirectTarget, { replace: true });
  }

  function handleCancelSignIn() {
    if (ssoSubmitting) {
      void cancelSsoSignIn();
      return;
    }
    if (submitting) {
      void cancelGitHubSignIn();
    }
  }

  return {
    submitting,
    error: error ?? ssoError,
    busy,
    githubSignInAvailable,
    githubSignInChecking,
    githubSignInUnavailableDescription,
    ssoSubmitting,
    ssoSignInAvailable,
    ssoSignInChecking,
    ssoSignInUnavailableDescription,
    ssoDisplayName,
    handleGitHubSignIn,
    handleSsoSignIn,
    handleCancelSignIn,
    handleContinueLocally,
    canContinueLocally,
  };
}
