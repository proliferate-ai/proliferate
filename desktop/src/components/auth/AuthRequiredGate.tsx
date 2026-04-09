import { Outlet } from "react-router-dom";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { useGitHubSignIn } from "@/hooks/auth/use-github-sign-in";
import { isProductAuthRequired } from "@/lib/domain/auth/auth-mode";
import { useAuthStore } from "@/stores/auth/auth-store";

export function AuthRequiredGate() {
  const status = useAuthStore((state) => state.status);
  const requiresAuth = isProductAuthRequired();

  if (!requiresAuth || status === "authenticated") {
    return <Outlet />;
  }

  return <SignInGateView />;
}

function SignInGateView() {
  const {
    signIn,
    submitting,
    error,
    signInAvailable,
    signInUnavailableDescription,
  } = useGitHubSignIn();

  return (
    <LoginScreen
      submitting={submitting}
      busy={submitting}
      error={error}
      githubSignInAvailable={signInAvailable}
      githubSignInUnavailableDescription={signInUnavailableDescription}
      onGitHubSignIn={() => {
        void signIn();
      }}
      onContinueLocally={() => {}}
      canContinueLocally={false}
    />
  );
}
