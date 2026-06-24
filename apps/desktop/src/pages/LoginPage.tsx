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
    handleGitHubSignIn,
    handleSsoSignIn,
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
      onGitHubSignIn={() => void handleGitHubSignIn()}
      onSsoSignIn={() => void handleSsoSignIn()}
      canContinueLocally={canContinueLocally}
      onContinueLocally={handleContinueLocally}
    />
  );
}
