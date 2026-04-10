import { useLoginPage } from "@/hooks/auth/use-login-page";
import { LoginScreen } from "@/components/auth/LoginScreen";

export function LoginPage() {
  const {
    submitting,
    busy,
    error,
    githubSignInAvailable,
    githubSignInChecking,
    githubSignInUnavailableDescription,
    handleGitHubSignIn,
    handleContinueLocally,
    canContinueLocally,
  } = useLoginPage();

  return (
    <LoginScreen
      submitting={submitting}
      busy={busy}
      error={error}
      githubSignInAvailable={githubSignInAvailable}
      githubSignInChecking={githubSignInChecking}
      githubSignInUnavailableDescription={githubSignInUnavailableDescription}
      onGitHubSignIn={() => void handleGitHubSignIn()}
      onContinueLocally={handleContinueLocally}
      canContinueLocally={canContinueLocally}
    />
  );
}
