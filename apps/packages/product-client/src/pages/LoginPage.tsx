import { useLoginPage } from "#product/hooks/auth/facade/use-login-page";
import { AuthScreenLayout } from "#product/components/auth/AuthScreenLayout";

export function LoginPage() {
  const {
    submitting,
    busy,
    error,
    githubSignInAvailable,
    githubSignInChecking,
    githubSignInUnavailableDescription,
    passwordSignInAvailable,
    passwordSubmitting,
    handleGitHubSignIn,
    handlePasswordSignIn,
    handleCancelSignIn,
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
      passwordSignInAvailable={passwordSignInAvailable}
      passwordSubmitting={passwordSubmitting}
      onGitHubSignIn={() => void handleGitHubSignIn()}
      onPasswordSignIn={(email, password) => void handlePasswordSignIn(email, password)}
      onCancelSignIn={handleCancelSignIn}
      canContinueLocally={canContinueLocally}
      onContinueLocally={handleContinueLocally}
    />
  );
}
