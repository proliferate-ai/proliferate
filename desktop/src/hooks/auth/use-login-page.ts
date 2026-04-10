import { useLocation, useNavigate } from "react-router-dom";
import { useGitHubSignIn } from "@/hooks/auth/use-github-sign-in";
import { isProductAuthRequired } from "@/lib/domain/auth/auth-mode";
import { useAuthStore } from "@/stores/auth/auth-store";
import { getRedirectTarget } from "@/lib/domain/auth/login-redirect";

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
  } = useGitHubSignIn();
  const canContinueLocally = !isProductAuthRequired();

  const redirectTarget = getRedirectTarget(location.state);
  const busy = submitting || status === "bootstrapping";

  async function handleGitHubSignIn() {
    try {
      await signIn();
      navigate(redirectTarget, { replace: true });
    } catch {
      // error is already surfaced via the hook's `error` state
    }
  }

  function handleContinueLocally() {
    navigate(redirectTarget, { replace: true });
  }

  return {
    submitting,
    error,
    busy,
    githubSignInAvailable,
    githubSignInChecking,
    githubSignInUnavailableDescription,
    handleGitHubSignIn,
    handleContinueLocally,
    canContinueLocally,
  };
}
