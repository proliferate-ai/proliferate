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
    ssoSubmitting,
    ssoSignInAvailable,
    ssoSignInChecking,
    ssoSignInUnavailableDescription,
    ssoDisplayName,
    passwordSignInAvailable,
    passwordSubmitting,
    handleGitHubSignIn,
    handleSsoSignIn,
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
      ssoSubmitting={ssoSubmitting}
      ssoSignInAvailable={ssoSignInAvailable}
      ssoSignInChecking={ssoSignInChecking}
      ssoSignInUnavailableDescription={ssoSignInUnavailableDescription}
      ssoDisplayName={ssoDisplayName}
      passwordSignInAvailable={passwordSignInAvailable}
      passwordSubmitting={passwordSubmitting}
      onGitHubSignIn={() => void handleGitHubSignIn()}
      onSsoSignIn={() => void handleSsoSignIn()}
      onPasswordSignIn={(email, password) => void handlePasswordSignIn(email, password)}
      onCancelSignIn={handleCancelSignIn}
      canContinueLocally={canContinueLocally}
      onContinueLocally={handleContinueLocally}
    />
  );
}
