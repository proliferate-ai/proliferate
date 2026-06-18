import { useLoginPage } from "@/hooks/auth/facade/use-login-page";
import { AuthScreenLayout } from "@/components/auth/AuthScreenLayout";

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
    <AuthScreenLayout
      mode="auth"
      markComplete
      submitting={submitting}
      busy={busy}
      error={error}
      githubSignInAvailable={githubSignInAvailable}
      githubSignInChecking={githubSignInChecking}
      githubSignInUnavailableDescription={githubSignInUnavailableDescription}
      onGitHubSignIn={() => void handleGitHubSignIn()}
      canContinueLocally={canContinueLocally}
      onContinueLocally={handleContinueLocally}
    />
  );
}
